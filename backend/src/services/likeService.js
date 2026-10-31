/**
 * Likes Service (Phase 3.4.3)
 * Manages post likes, unlikes, and liker listings with strict parent-row lock ordering,
 * transactional counter integrity, idempotency, and private-profile authorization.
 */
const { query, withTransaction } = require('../config/database');
const { AppError } = require('./authService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates post UUID parameter format.
 */
const validatePostId = (postId) => {
    if (!postId || typeof postId !== 'string' || !UUID_REGEX.test(postId)) {
        throw new AppError('POST_NOT_FOUND', 'Post not found.', 404);
    }
};

/**
 * Checks authorization to access a post from a potentially private profile.
 * Reusable across likes and comments services.
 */
const checkPostAccess = async (postAuthorId, isPrivate, viewerUserId, clientOrQuery = query) => {
    if (!isPrivate) {
        return true;
    }

    if (viewerUserId && viewerUserId === postAuthorId) {
        return true;
    }

    if (!viewerUserId) {
        throw new AppError('PRIVATE_PROFILE', 'This profile is private. Follow this user to view their posts.', 403);
    }

    const followSql = 'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1;';
    const followRes = typeof clientOrQuery.query === 'function'
        ? await clientOrQuery.query(followSql, [viewerUserId, postAuthorId])
        : await clientOrQuery(followSql, [viewerUserId, postAuthorId]);

    if (followRes.rows.length === 0) {
        throw new AppError('PRIVATE_PROFILE', 'This profile is private. Follow this user to view their posts.', 403);
    }

    return true;
};

/**
 * Likes a post for the authenticated user.
 * Locks parent post row first (SELECT ... FOR UPDATE).
 * Idempotent: repeated like requests do not increment counter or throw errors.
 * Preserves posts.updated_at without modification.
 */
const likePost = async (postId, userId) => {
    validatePostId(postId);

    return await withTransaction(async (client) => {
        // 1. Lock parent post row first
        const postRes = await client.query(
            `SELECT p.id, p.user_id, p.deleted_at, p.likes_count, pr.is_private
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

        // 3. Check if user already liked the post
        const existingLike = await client.query(
            'SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2;',
            [postId, userId]
        );

        let currentLikesCount = post.likes_count;

        if (existingLike.rows.length === 0) {
            // New like: insert like row and atomically increment counter
            await client.query(
                'INSERT INTO post_likes (post_id, user_id, created_at) VALUES ($1, $2, NOW());',
                [postId, userId]
            );

            // Never modify posts.updated_at
            const updateRes = await client.query(
                'UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count;',
                [postId]
            );
            currentLikesCount = updateRes.rows[0].likes_count;
        }

        return {
            message: 'Post liked successfully.',
            liked: true,
            likes_count: currentLikesCount
        };
    });
};

/**
 * Unlikes a post for the authenticated user.
 * Locks parent post row first (SELECT ... FOR UPDATE).
 * Idempotent: repeated unlike requests do not decrement below 0 or throw errors.
 * Preserves posts.updated_at without modification.
 */
const unlikePost = async (postId, userId) => {
    validatePostId(postId);

    return await withTransaction(async (client) => {
        // 1. Lock parent post row first
        const postRes = await client.query(
            `SELECT p.id, p.user_id, p.deleted_at, p.likes_count, pr.is_private
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

        // 3. Attempt to delete like edge
        const delRes = await client.query(
            'DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id;',
            [postId, userId]
        );

        let currentLikesCount = post.likes_count;

        if (delRes.rowCount > 0) {
            // Decrement counter only when row was actually deleted (guarded by nonnegative CHECK constraint)
            const updateRes = await client.query(
                'UPDATE posts SET likes_count = likes_count - 1 WHERE id = $1 RETURNING likes_count;',
                [postId]
            );
            currentLikesCount = updateRes.rows[0].likes_count;
        }

        return {
            message: 'Post unliked successfully.',
            liked: false,
            likes_count: currentLikesCount
        };
    });
};

/**
 * Retrieves paginated list of users who liked a post.
 * Enforces post author profile privacy rules.
 */
const getPostLikes = async (postId, { page = 1, limit = 20 } = {}, viewerUserId = null) => {
    validatePostId(postId);

    // 1. Verify post existence and active status
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

    // 4. Query total likes count
    const countRes = await query(
        'SELECT COUNT(*)::int AS total FROM post_likes WHERE post_id = $1;',
        [postId]
    );
    const total = countRes.rows[0].total;

    // 5. Query paginated likes list
    const likesRes = await query(
        `SELECT 
             pl.created_at AS liked_at,
             pr.id, pr.username, pr.display_name, pr.avatar_url, pr.bio
         FROM post_likes pl
         JOIN profiles pr ON pr.id = pl.user_id
         JOIN users u ON u.id = pl.user_id
         WHERE pl.post_id = $1 AND u.is_active = true
         ORDER BY pl.created_at DESC, pl.user_id ASC
         LIMIT $2 OFFSET $3;`,
        [postId, parsedLimit, offset]
    );

    const formattedLikes = likesRes.rows.map((row) => ({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        bio: row.bio,
        liked_at: row.liked_at
    }));

    return {
        likes: formattedLikes,
        pagination: {
            page: parsedPage,
            limit: parsedLimit,
            count: formattedLikes.length,
            total,
            total_pages: total === 0 ? 0 : Math.ceil(total / parsedLimit)
        }
    };
};

module.exports = {
    validatePostId,
    checkPostAccess,
    likePost,
    unlikePost,
    getPostLikes
};
