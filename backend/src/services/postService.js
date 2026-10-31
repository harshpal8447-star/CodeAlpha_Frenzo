/**
 * Posts Service (Phase 3.3.3)
 * Manages post lifecycle: creation, retrieval, updates, soft-deletion,
 * author privacy enforcement, and timeline pagination.
 */
const { query, withTransaction } = require('../config/database');
const { AppError } = require('./authService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONTENT_LENGTH = 2000;

/**
 * Validates and normalizes post content string.
 */
const validateContent = (content) => {
    if (!content || typeof content !== 'string') {
        throw new AppError('INVALID_CONTENT', 'Post content must be a non-empty text string.', 400);
    }
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        throw new AppError('INVALID_CONTENT', 'Post content cannot be empty.', 400);
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
        throw new AppError('INVALID_CONTENT', `Post content cannot exceed ${MAX_CONTENT_LENGTH} characters.`, 400);
    }
    return trimmed;
};

/**
 * Validates post UUID parameter format.
 */
const validatePostId = (postId) => {
    if (!postId || typeof postId !== 'string' || !UUID_REGEX.test(postId)) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }
};

/**
 * Creates a new text post within an atomic transaction.
 * Increments profiles.posts_count synchronously.
 */
const createPost = async (userId, { content }) => {
    const trimmedContent = validateContent(content);

    return await withTransaction(async (client) => {
        // 1. Insert post record with empty media array (image upload deferred to Phase 3.4)
        const insertSql = `
            INSERT INTO posts (user_id, content, media_urls, created_at, updated_at)
            VALUES ($1, $2, '[]'::jsonb, NOW(), NOW())
            RETURNING id, user_id, content, media_urls, created_at, updated_at;
        `;
        const postRes = await client.query(insertSql, [userId, trimmedContent]);
        const postRow = postRes.rows[0];

        // 2. Atomically increment profiles.posts_count and retrieve author profile
        const profileSql = `
            UPDATE profiles
            SET posts_count = posts_count + 1, updated_at = NOW()
            WHERE id = $1
            RETURNING id, username, display_name, avatar_url;
        `;
        const profileRes = await client.query(profileSql, [userId]);
        if (profileRes.rows.length === 0) {
            throw new AppError('USER_NOT_FOUND', 'Author profile not found.', 404);
        }
        const authorRow = profileRes.rows[0];

        return {
            id: postRow.id,
            user_id: postRow.user_id,
            content: postRow.content,
            media_urls: postRow.media_urls,
            created_at: postRow.created_at,
            updated_at: postRow.updated_at,
            author: {
                id: authorRow.id,
                username: authorRow.username,
                display_name: authorRow.display_name,
                avatar_url: authorRow.avatar_url
            },
            is_own_post: true
        };
    });
};

/**
 * Retrieves a single post by ID.
 * Enforces author profile privacy rules for guests and non-followers.
 */
const getPostById = async (postId, viewerUserId = null) => {
    validatePostId(postId);

    const postSql = `
        SELECT 
            p.id, p.user_id, p.content, p.media_urls, p.created_at, p.updated_at,
            pr.username, pr.display_name, pr.avatar_url, pr.is_private, u.is_active
        FROM posts p
        JOIN profiles pr ON pr.id = p.user_id
        JOIN users u ON u.id = p.user_id
        WHERE p.id = $1 AND p.deleted_at IS NULL
        LIMIT 1;
    `;

    const res = await query(postSql, [postId]);
    const row = res.rows[0];

    if (!row || !row.is_active) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }

    const isOwnPost = viewerUserId ? viewerUserId === row.user_id : false;

    // Privacy enforcement: If author's profile is private, only the author or active followers can view
    if (row.is_private && !isOwnPost) {
        let isFollowing = false;
        if (viewerUserId) {
            const followCheck = await query(
                'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1;',
                [viewerUserId, row.user_id]
            );
            isFollowing = followCheck.rows.length > 0;
        }

        if (!isFollowing) {
            throw new AppError('PRIVATE_PROFILE', 'This profile is private. Follow this user to view their posts.', 403);
        }
    }

    return {
        id: row.id,
        user_id: row.user_id,
        content: row.content,
        media_urls: row.media_urls,
        created_at: row.created_at,
        updated_at: row.updated_at,
        author: {
            id: row.user_id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url
        },
        is_own_post: isOwnPost
    };
};

/**
 * Updates an authenticated user's own post content.
 * Guarantees author ownership and non-deleted status.
 */
const updatePost = async (postId, userId, { content }) => {
    validatePostId(postId);
    const trimmedContent = validateContent(content);

    // Verify existing post and author ownership
    const checkSql = `
        SELECT id, user_id, deleted_at
        FROM posts
        WHERE id = $1;
    `;
    const checkRes = await query(checkSql, [postId]);
    const existing = checkRes.rows[0];

    if (!existing || existing.deleted_at !== null) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }

    if (existing.user_id !== userId) {
        throw new AppError('FORBIDDEN', 'You do not have permission to edit this post.', 403);
    }

    const updateSql = `
        UPDATE posts
        SET content = $1, updated_at = NOW()
        WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
        RETURNING id, user_id, content, media_urls, created_at, updated_at;
    `;
    const updateRes = await query(updateSql, [trimmedContent, postId, userId]);
    if (updateRes.rows.length === 0) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }
    const updatedRow = updateRes.rows[0];

    // Fetch author metadata
    const profileRes = await query(
        'SELECT id, username, display_name, avatar_url FROM profiles WHERE id = $1;',
        [userId]
    );
    const authorRow = profileRes.rows[0];

    return {
        id: updatedRow.id,
        user_id: updatedRow.user_id,
        content: updatedRow.content,
        media_urls: updatedRow.media_urls,
        created_at: updatedRow.created_at,
        updated_at: updatedRow.updated_at,
        author: {
            id: authorRow.id,
            username: authorRow.username,
            display_name: authorRow.display_name,
            avatar_url: authorRow.avatar_url
        },
        is_own_post: true
    };
};

/**
 * Soft-deletes an authenticated user's own post.
 * Conditionally decrements profiles.posts_count within an atomic transaction.
 * Idempotent against concurrent/repeated delete requests.
 */
const deletePost = async (postId, userId) => {
    validatePostId(postId);

    // Verify post exists and author ownership
    const checkSql = `
        SELECT id, user_id, deleted_at
        FROM posts
        WHERE id = $1;
    `;
    const checkRes = await query(checkSql, [postId]);
    const existing = checkRes.rows[0];

    if (!existing || existing.deleted_at !== null) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }

    if (existing.user_id !== userId) {
        throw new AppError('FORBIDDEN', 'You do not have permission to delete this post.', 403);
    }

    return await withTransaction(async (client) => {
        // 1. Soft delete post record only if not already deleted
        const deleteSql = `
            UPDATE posts
            SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
            RETURNING id;
        `;
        const deleteRes = await client.query(deleteSql, [postId, userId]);

        if (deleteRes.rowCount === 0) {
            throw new AppError('POST_NOT_FOUND', 'Post not found or already deleted.', 404);
        }

        // 2. Conditionally decrement profiles.posts_count (ensured >= 0 via GREATEST)
        const counterSql = `
            UPDATE profiles
            SET posts_count = GREATEST(0, posts_count - 1), updated_at = NOW()
            WHERE id = $1;
        `;
        await client.query(counterSql, [userId]);

        return {
            message: 'Post deleted successfully.',
            post_id: postId
        };
    });
};

/**
 * Retrieves a user's post timeline ordered by created_at DESC, id DESC.
 * Enforces account privacy for private profiles and computes pagination metadata.
 */
const getUserPosts = async (username, { page = 1, limit = 20 } = {}, viewerUserId = null) => {
    if (!username || typeof username !== 'string') {
        throw new AppError('INVALID_USERNAME', 'Username is required.', 400);
    }

    const normalizedUsername = username.trim().toLowerCase();

    // Parse & clamp pagination parameters
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

    // Resolve author user & profile
    const profileSql = `
        SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_private, u.is_active
        FROM profiles p
        JOIN users u ON u.id = p.id
        WHERE LOWER(p.username) = $1
        LIMIT 1;
    `;
    const profileRes = await query(profileSql, [normalizedUsername]);
    const targetUser = profileRes.rows[0];

    if (!targetUser || !targetUser.is_active) {
        throw new AppError('USER_NOT_FOUND', 'User profile not found.', 404);
    }

    const isOwnProfile = viewerUserId ? viewerUserId === targetUser.id : false;

    // Enforce private account visibility
    if (targetUser.is_private && !isOwnProfile) {
        let isFollowing = false;
        if (viewerUserId) {
            const followCheck = await query(
                'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1;',
                [viewerUserId, targetUser.id]
            );
            isFollowing = followCheck.rows.length > 0;
        }

        if (!isFollowing) {
            throw new AppError('PRIVATE_PROFILE', 'This profile is private. Follow this user to view their posts.', 403);
        }
    }

    // Query total active posts count
    const countSql = `
        SELECT COUNT(*)::int AS total
        FROM posts
        WHERE user_id = $1 AND deleted_at IS NULL;
    `;
    const countRes = await query(countSql, [targetUser.id]);
    const total = countRes.rows[0].total;

    // Query active posts page using deterministic timeline index (idx_posts_user_timeline)
    const postsSql = `
        SELECT id, user_id, content, media_urls, created_at, updated_at
        FROM posts
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3;
    `;
    const postsRes = await query(postsSql, [targetUser.id, parsedLimit, offset]);

    const authorObj = {
        id: targetUser.id,
        username: targetUser.username,
        display_name: targetUser.display_name,
        avatar_url: targetUser.avatar_url
    };

    const formattedPosts = postsRes.rows.map((post) => ({
        id: post.id,
        user_id: post.user_id,
        content: post.content,
        media_urls: post.media_urls,
        created_at: post.created_at,
        updated_at: post.updated_at,
        author: authorObj,
        is_own_post: isOwnProfile
    }));

    return {
        posts: formattedPosts,
        pagination: {
            page: parsedPage,
            limit: parsedLimit,
            count: formattedPosts.length,
            total,
            total_pages: total === 0 ? 0 : Math.ceil(total / parsedLimit)
        }
    };
};

module.exports = {
    createPost,
    getPostById,
    updatePost,
    deletePost,
    getUserPosts
};
