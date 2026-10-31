/**
 * Comments Service (Phase 3.4.3)
 * Manages post comment creation, deterministic listing, author editing,
 * authorized soft-deletion (by comment author or post author),
 * strict parent-first lock ordering, and counter integrity.
 */
const { query, withTransaction } = require('../config/database');
const { AppError } = require('./authService');
const { checkPostAccess, validatePostId } = require('./likeService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMMENT_LENGTH = 500;

/**
 * Validates and normalizes comment content string.
 * Enforces non-empty trimmed text up to 500 characters.
 */
const validateCommentContent = (content) => {
    if (!content || typeof content !== 'string') {
        throw new AppError('INVALID_CONTENT', 'Comment content must be a non-empty text string.', 400);
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        throw new AppError('INVALID_CONTENT', 'Comment content cannot be empty.', 400);
    }
    if (content.length > MAX_COMMENT_LENGTH) {
        throw new AppError('INVALID_CONTENT', `Comment content cannot exceed ${MAX_COMMENT_LENGTH} characters.`, 400);
    }
    return trimmed;
};

/**
 * Validates comment UUID parameter format.
 */
const validateCommentId = (commentId) => {
    if (!commentId || typeof commentId !== 'string' || !UUID_REGEX.test(commentId)) {
        throw new AppError('COMMENT_NOT_FOUND', 'Comment not found.', 404);
    }
};

/**
 * Creates a new comment on a post within an atomic transaction.
 * Locks parent post row first (SELECT ... FOR UPDATE).
 * Atomically increments posts.comments_count.
 * Never modifies posts.updated_at.
 */
const createComment = async (postId, userId, { content }) => {
    validatePostId(postId);
    const trimmedContent = validateCommentContent(content);

    return await withTransaction(async (client) => {
        // 1. Lock parent post row first
        const postRes = await client.query(
            `SELECT p.id, p.user_id, p.deleted_at, p.comments_count, pr.is_private
             FROM posts p
             JOIN profiles pr ON pr.id = p.user_id
             WHERE p.id = $1
             FOR UPDATE OF p;`,
            [postId]
        );
        const post = postRes.rows[0];

        if (!post || post.deleted_at !== null) {
            throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
        }

        // 2. Privacy enforcement
        await checkPostAccess(post.user_id, post.is_private, userId, client);

        // 3. Insert comment record
        const insertSql = `
            INSERT INTO post_comments (post_id, user_id, content, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING id, post_id, user_id, content, created_at, updated_at;
        `;
        const commentRes = await client.query(insertSql, [postId, userId, trimmedContent]);
        const commentRow = commentRes.rows[0];

        // 4. Atomically increment posts.comments_count (never modify posts.updated_at)
        await client.query(
            'UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1;',
            [postId]
        );

        // 5. Retrieve author profile metadata
        const profileRes = await client.query(
            'SELECT id, username, display_name, avatar_url FROM profiles WHERE id = $1;',
            [userId]
        );
        const authorRow = profileRes.rows[0];

        return {
            message: 'Comment created successfully.',
            comment: {
                id: commentRow.id,
                post_id: commentRow.post_id,
                content: commentRow.content,
                created_at: commentRow.created_at,
                updated_at: commentRow.updated_at,
                author: {
                    id: authorRow.id,
                    username: authorRow.username,
                    display_name: authorRow.display_name,
                    avatar_url: authorRow.avatar_url
                },
                is_own_comment: true
            }
        };
    });
};

/**
 * Retrieves paginated comments for a post in deterministic chronological order (created_at ASC, id ASC).
 * Soft-deleted comments are strictly excluded.
 * Enforces post author profile privacy rules.
 */
const getPostComments = async (postId, { page = 1, limit = 20 } = {}, viewerUserId = null) => {
    validatePostId(postId);

    // 1. Verify post exists and active
    const postRes = await query(
        `SELECT p.id, p.user_id, p.deleted_at, pr.is_private
         FROM posts p
         JOIN profiles pr ON pr.id = p.user_id
         WHERE p.id = $1;`,
        [postId]
    );
    const post = postRes.rows[0];

    if (!post || post.deleted_at !== null) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }

    // 2. Enforce privacy
    await checkPostAccess(post.user_id, post.is_private, viewerUserId);

    // 3. Parse pagination parameters
    let parsedPage = parseInt(page, 10);
    if (isNaN(parsedPage) || parsedPage < 1) {
        parsedPage = 1;
    }

    let parsedLimit = parseInt(limit, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1) {
        parsedLimit = 20;
    } else if (parsedLimit > 50) {
        parsedLimit = 50;
    }

    const offset = (parsedPage - 1) * parsedLimit;

    // 4. Query total active comments count
    const countRes = await query(
        'SELECT COUNT(*)::int AS total FROM post_comments WHERE post_id = $1 AND deleted_at IS NULL;',
        [postId]
    );
    const total = countRes.rows[0].total;

    // 5. Query comments page (deterministic index: idx_comments_post_timeline)
    const commentsRes = await query(
        `SELECT 
             c.id, c.post_id, c.user_id, c.content, c.created_at, c.updated_at,
             pr.username, pr.display_name, pr.avatar_url
         FROM post_comments c
         JOIN profiles pr ON pr.id = c.user_id
         JOIN users u ON u.id = c.user_id
         WHERE c.post_id = $1 AND c.deleted_at IS NULL AND u.is_active = true
         ORDER BY c.created_at ASC, c.id ASC
         LIMIT $2 OFFSET $3;`,
        [postId, parsedLimit, offset]
    );

    const formattedComments = commentsRes.rows.map((row) => ({
        id: row.id,
        post_id: row.post_id,
        content: row.content,
        created_at: row.created_at,
        updated_at: row.updated_at,
        author: {
            id: row.user_id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url
        },
        is_own_comment: viewerUserId ? viewerUserId === row.user_id : false
    }));

    return {
        comments: formattedComments,
        pagination: {
            page: parsedPage,
            limit: parsedLimit,
            count: formattedComments.length,
            total,
            total_pages: total === 0 ? 0 : Math.ceil(total / parsedLimit)
        }
    };
};

/**
 * Updates an authenticated user's own comment content.
 * Concurrency:
 *   1. Identifies parent post.
 *   2. Locks parent post row first (SELECT ... FOR UPDATE).
 *   3. Rechecks parent post is active (not soft-deleted).
 *   4. Locks comment row (SELECT ... FOR UPDATE).
 *   5. Rechecks comment is active (not soft-deleted).
 *   6. Verifies ownership: comment author ONLY (post author may not edit another's comment).
 *   7. Updates comment content and updated_at.
 *   Never modifies posts.updated_at or posts.comments_count.
 */
const updateComment = async (commentId, userId, { content }) => {
    validateCommentId(commentId);
    const trimmedContent = validateCommentContent(content);

    return await withTransaction(async (client) => {
        // 1. Identify parent post ID
        const findRes = await client.query(
            'SELECT post_id FROM post_comments WHERE id = $1;',
            [commentId]
        );
        if (findRes.rows.length === 0) {
            throw new AppError('COMMENT_NOT_FOUND', 'Comment not found.', 404);
        }
        const parentPostId = findRes.rows[0].post_id;

        // 2. Lock parent post row FIRST
        const postRes = await client.query(
            'SELECT id, user_id, deleted_at FROM posts WHERE id = $1 FOR UPDATE;',
            [parentPostId]
        );
        const post = postRes.rows[0];

        if (!post || post.deleted_at !== null) {
            throw new AppError('POST_NOT_FOUND', 'Post not found or has been deleted.', 404);
        }

        // 3. Lock comment row SECOND
        const commentRes = await client.query(
            'SELECT id, post_id, user_id, content, created_at, updated_at, deleted_at FROM post_comments WHERE id = $1 FOR UPDATE;',
            [commentId]
        );
        const comment = commentRes.rows[0];

        if (!comment || comment.deleted_at !== null) {
            throw new AppError('COMMENT_NOT_FOUND', 'Comment not found or has been deleted.', 404);
        }

        // 4. Verify ownership: comment author only
        if (comment.user_id !== userId) {
            throw new AppError('FORBIDDEN', 'You do not have permission to edit this comment.', 403);
        }

        // 5. Update comment row
        const updateSql = `
            UPDATE post_comments
            SET content = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING id, post_id, user_id, content, created_at, updated_at;
        `;
        const updateRes = await client.query(updateSql, [trimmedContent, commentId]);
        const updatedRow = updateRes.rows[0];

        // 6. Retrieve author metadata
        const profileRes = await client.query(
            'SELECT id, username, display_name, avatar_url FROM profiles WHERE id = $1;',
            [userId]
        );
        const authorRow = profileRes.rows[0];

        return {
            message: 'Comment updated successfully.',
            comment: {
                id: updatedRow.id,
                post_id: updatedRow.post_id,
                content: updatedRow.content,
                created_at: updatedRow.created_at,
                updated_at: updatedRow.updated_at,
                author: {
                    id: authorRow.id,
                    username: authorRow.username,
                    display_name: authorRow.display_name,
                    avatar_url: authorRow.avatar_url
                },
                is_own_comment: true
            }
        };
    });
};

/**
 * Soft-deletes a comment and decrements posts.comments_count.
 * Concurrency:
 *   1. Identifies parent post.
 *   2. Locks parent post row first (SELECT ... FOR UPDATE).
 *   3. Rechecks parent post is active.
 *   4. Locks comment row (SELECT ... FOR UPDATE).
 *   5. Rechecks comment is active.
 *   6. Authorization: comment author OR parent post author may delete.
 *   7. Soft-deletes comment (deleted_at = NOW(), updated_at = NOW()).
 *   8. Decrements posts.comments_count transactionally without GREATEST.
 *   Never modifies posts.updated_at.
 */
const deleteComment = async (commentId, userId) => {
    validateCommentId(commentId);

    return await withTransaction(async (client) => {
        // 1. Identify parent post ID
        const findRes = await client.query(
            'SELECT post_id FROM post_comments WHERE id = $1;',
            [commentId]
        );
        if (findRes.rows.length === 0) {
            throw new AppError('COMMENT_NOT_FOUND', 'Comment not found.', 404);
        }
        const parentPostId = findRes.rows[0].post_id;

        // 2. Lock parent post row FIRST
        const postRes = await client.query(
            'SELECT id, user_id, deleted_at, comments_count FROM posts WHERE id = $1 FOR UPDATE;',
            [parentPostId]
        );
        const post = postRes.rows[0];

        if (!post || post.deleted_at !== null) {
            throw new AppError('POST_NOT_FOUND', 'Post not found or has been deleted.', 404);
        }

        // 3. Lock comment row SECOND
        const commentRes = await client.query(
            'SELECT id, post_id, user_id, deleted_at FROM post_comments WHERE id = $1 FOR UPDATE;',
            [commentId]
        );
        const comment = commentRes.rows[0];

        if (!comment || comment.deleted_at !== null) {
            throw new AppError('COMMENT_NOT_FOUND', 'Comment not found or already deleted.', 404);
        }

        // 4. Verify permission: comment author OR post author
        const isCommentAuthor = comment.user_id === userId;
        const isPostAuthor = post.user_id === userId;

        if (!isCommentAuthor && !isPostAuthor) {
            throw new AppError('FORBIDDEN', 'You do not have permission to delete this comment.', 403);
        }

        // 5. Soft-delete comment
        const delRes = await client.query(
            `UPDATE post_comments
             SET deleted_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND deleted_at IS NULL
             RETURNING id;`,
            [commentId]
        );

        if (delRes.rowCount > 0) {
            // 6. Decrement counter only when comment row was actually soft-deleted
            // Guarded by chk_posts_comments_count_nonnegative
            await client.query(
                'UPDATE posts SET comments_count = comments_count - 1 WHERE id = $1;',
                [parentPostId]
            );
        }

        return {
            message: 'Comment deleted successfully.',
            comment_id: commentId
        };
    });
};

module.exports = {
    validateCommentContent,
    validateCommentId,
    createComment,
    getPostComments,
    updateComment,
    deleteComment
};
