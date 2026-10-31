/**
 * User & Social Graph Service (Phase 3.2)
 * Implements profile retrieval, profile updates, follower/following management,
 * and parameterized user discovery with strict data privacy.
 */
const { query, withTransaction } = require('../config/database');
const { AppError } = require('./authService');

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

/**
 * Validates and normalizes profile update fields.
 */
const validateProfileUpdate = ({ display_name, username, bio, website }) => {
    const updates = {};

    if (display_name !== undefined) {
        if (typeof display_name !== 'string') {
            throw new AppError('INVALID_DISPLAY_NAME', 'Display name must be a text string.', 400);
        }
        const trimmed = display_name.trim();
        if (trimmed.length < 1 || trimmed.length > 60) {
            throw new AppError('INVALID_DISPLAY_NAME', 'Display name must be between 1 and 60 characters.', 400);
        }
        updates.display_name = trimmed;
    }

    if (username !== undefined) {
        if (typeof username !== 'string') {
            throw new AppError('INVALID_USERNAME', 'Username must be a text string.', 400);
        }
        const normalized = username.trim().toLowerCase();
        if (!USERNAME_REGEX.test(normalized)) {
            throw new AppError(
                'INVALID_USERNAME',
                'Username must be 3-30 characters containing only letters, numbers, and underscores.',
                400
            );
        }
        updates.username = normalized;
    }

    if (bio !== undefined) {
        if (bio === null || bio === '') {
            updates.bio = null;
        } else {
            if (typeof bio !== 'string') {
                throw new AppError('INVALID_BIO', 'Bio must be a text string.', 400);
            }
            const trimmedBio = bio.trim();
            if (trimmedBio.length > 300) {
                throw new AppError('INVALID_BIO', 'Bio cannot exceed 300 characters.', 400);
            }
            updates.bio = trimmedBio;
        }
    }

    if (website !== undefined) {
        if (website === null || website === '') {
            updates.website = null;
        } else {
            if (typeof website !== 'string') {
                throw new AppError('INVALID_WEBSITE', 'Website must be a valid URL string.', 400);
            }
            const trimmedWebsite = website.trim();
            const urlRegex = /^https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/;
            if (!urlRegex.test(trimmedWebsite) || trimmedWebsite.length > 255) {
                throw new AppError('INVALID_WEBSITE', 'Please provide a valid website URL (http:// or https://).', 400);
            }
            updates.website = trimmedWebsite;
        }
    }

    return updates;
};

/**
 * Retrieves a user's public profile by username.
 * Respects account privacy and includes viewer-specific relationship status.
 * Never exposes emails, password hashes, or private credentials.
 */
const getProfileByUsername = async (username, viewerUserId = null) => {
    if (!username || typeof username !== 'string') {
        throw new AppError('INVALID_USERNAME', 'Username is required.', 400);
    }

    const normalizedUsername = username.trim().toLowerCase();

    const sql = `
        SELECT 
            p.id, p.username, p.display_name, p.bio, p.avatar_url, p.banner_url,
            p.website, p.is_private, p.followers_count, p.following_count, p.posts_count,
            p.created_at, u.is_active
        FROM profiles p
        JOIN users u ON p.id = u.id
        WHERE LOWER(p.username) = $1
        LIMIT 1;
    `;

    const res = await query(sql, [normalizedUsername]);
    const profile = res.rows[0];

    if (!profile || !profile.is_active) {
        throw new AppError('USER_NOT_FOUND', 'User profile not found.', 404);
    }

    const isOwnProfile = viewerUserId ? viewerUserId === profile.id : false;
    let isFollowing = false;

    if (viewerUserId && !isOwnProfile) {
        const followCheck = await query(
            'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1;',
            [viewerUserId, profile.id]
        );
        isFollowing = followCheck.rows.length > 0;
    }

    // Privacy enforcement:
    // If account is private, and viewer is neither owner nor an approved follower,
    // restrict detailed feed / personal metadata.
    // Note: In Phase 3.2, private account approval requests are deferred; privacy hides sensitive content.
    const isRestricted = profile.is_private && !isOwnProfile && !isFollowing;

    return {
        id: profile.id,
        username: profile.username,
        display_name: profile.display_name,
        bio: isRestricted ? 'This account is private.' : profile.bio,
        avatar_url: profile.avatar_url,
        banner_url: isRestricted ? null : profile.banner_url,
        website: isRestricted ? null : profile.website,
        is_private: profile.is_private,
        followers_count: profile.followers_count,
        following_count: profile.following_count,
        posts_count: profile.posts_count,
        created_at: profile.created_at,
        is_following: isFollowing,
        is_own_profile: isOwnProfile,
        is_restricted: isRestricted
    };
};

/**
 * Updates an authenticated user's own profile.
 * Guarantees case-insensitive username uniqueness using atomic collision checks.
 */
const updateProfile = async (userId, payload) => {
    const updates = validateProfileUpdate(payload);

    if (Object.keys(updates).length === 0) {
        throw new AppError('NO_UPDATES_PROVIDED', 'No valid profile update fields provided.', 400);
    }

    return await withTransaction(async (client) => {
        // If username is changing, ensure new username is not already claimed
        if (updates.username) {
            const conflictCheck = await client.query(
                'SELECT id FROM profiles WHERE LOWER(username) = $1 AND id <> $2 LIMIT 1;',
                [updates.username, userId]
            );
            if (conflictCheck.rows.length > 0) {
                throw new AppError('USERNAME_ALREADY_EXISTS', 'This username is already taken. Please choose another.', 409);
            }
        }

        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, val] of Object.entries(updates)) {
            setClauses.push(`${key} = $${paramIndex}`);
            values.push(val);
            paramIndex++;
        }

        setClauses.push(`updated_at = NOW()`);
        values.push(userId);

        const updateSql = `
            UPDATE profiles
            SET ${setClauses.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, username, display_name, bio, avatar_url, banner_url, website, is_private, followers_count, following_count, posts_count, updated_at;
        `;

        const res = await client.query(updateSql, values);
        if (res.rows.length === 0) {
            throw new AppError('USER_NOT_FOUND', 'User profile not found.', 404);
        }

        return res.rows[0];
    });
};

/**
 * Follows a target user transactionally.
 * Prevents self-follow, handles duplicate follows via ON CONFLICT DO NOTHING,
 * and increments follower/following counters atomically only when a new edge is inserted.
 */
const followUser = async (followerId, targetUsername) => {
    if (!targetUsername || typeof targetUsername !== 'string') {
        throw new AppError('INVALID_TARGET', 'Target username is required.', 400);
    }

    const normalizedTarget = targetUsername.trim().toLowerCase();

    return await withTransaction(async (client) => {
        const targetRes = await client.query(
            'SELECT id, is_private FROM profiles WHERE LOWER(username) = $1 LIMIT 1;',
            [normalizedTarget]
        );
        const target = targetRes.rows[0];

        if (!target) {
            throw new AppError('USER_NOT_FOUND', 'User to follow was not found.', 404);
        }

        if (followerId === target.id) {
            throw new AppError('CANNOT_FOLLOW_SELF', 'You cannot follow yourself.', 400);
        }

        // Insert follow record; if duplicate, DO NOTHING
        const insertRes = await client.query(
            `INSERT INTO follows (follower_id, following_id)
             VALUES ($1, $2)
             ON CONFLICT (follower_id, following_id) DO NOTHING
             RETURNING follower_id;`,
            [followerId, target.id]
        );

        const wasInserted = insertRes.rows.length > 0;

        if (wasInserted) {
            // Increment follower's following_count and target's followers_count atomically
            await client.query(
                'UPDATE profiles SET following_count = following_count + 1, updated_at = NOW() WHERE id = $1;',
                [followerId]
            );
            await client.query(
                'UPDATE profiles SET followers_count = followers_count + 1, updated_at = NOW() WHERE id = $1;',
                [target.id]
            );
        }

        // Query updated counts for response
        const targetUpdated = await client.query(
            'SELECT followers_count, following_count FROM profiles WHERE id = $1;',
            [target.id]
        );

        return {
            message: wasInserted ? 'User followed successfully.' : 'You are already following this user.',
            is_following: true,
            followed: wasInserted,
            target_followers_count: targetUpdated.rows[0].followers_count
        };
    });
};

/**
 * Unfollows a target user transactionally.
 * Prevents self-unfollow, deletes follow edge, and decrements counters atomically
 * using GREATEST(0, count - 1) only when an edge was actually removed.
 */
const unfollowUser = async (followerId, targetUsername) => {
    if (!targetUsername || typeof targetUsername !== 'string') {
        throw new AppError('INVALID_TARGET', 'Target username is required.', 400);
    }

    const normalizedTarget = targetUsername.trim().toLowerCase();

    return await withTransaction(async (client) => {
        const targetRes = await client.query(
            'SELECT id FROM profiles WHERE LOWER(username) = $1 LIMIT 1;',
            [normalizedTarget]
        );
        const target = targetRes.rows[0];

        if (!target) {
            throw new AppError('USER_NOT_FOUND', 'User to unfollow was not found.', 404);
        }

        if (followerId === target.id) {
            throw new AppError('CANNOT_UNFOLLOW_SELF', 'You cannot unfollow yourself.', 400);
        }

        const deleteRes = await client.query(
            `DELETE FROM follows
             WHERE follower_id = $1 AND following_id = $2
             RETURNING follower_id;`,
            [followerId, target.id]
        );

        const wasDeleted = deleteRes.rows.length > 0;

        if (wasDeleted) {
            // Decrement follower's following_count and target's followers_count atomically
            await client.query(
                'UPDATE profiles SET following_count = GREATEST(0, following_count - 1), updated_at = NOW() WHERE id = $1;',
                [followerId]
            );
            await client.query(
                'UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1), updated_at = NOW() WHERE id = $1;',
                [target.id]
            );
        }

        const targetUpdated = await client.query(
            'SELECT followers_count, following_count FROM profiles WHERE id = $1;',
            [target.id]
        );

        return {
            message: wasDeleted ? 'User unfollowed successfully.' : 'You were not following this user.',
            is_following: false,
            unfollowed: wasDeleted,
            target_followers_count: targetUpdated.rows[0].followers_count
        };
    });
};

/**
 * Searches users by username or display name using safe parameterized SQL.
 * Never exposes private emails or account secrets. Enforces strict limit clamping (1-50).
 */
const searchUsers = async (queryTerm, limit = 20, viewerUserId = null) => {
    if (!queryTerm || typeof queryTerm !== 'string') {
        return [];
    }

    const trimmed = queryTerm.trim();
    if (trimmed.length === 0) {
        return [];
    }

    // Clamp limit safely between 1 and 50
    const clampedLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));

    // Sanitize queryTerm to avoid wildcards overwhelming indexes
    const sanitizedPattern = `%${trimmed.replace(/[%_\\]/g, '\\$&')}%`;

    const sql = `
        SELECT 
            p.id, p.username, p.display_name, p.bio, p.avatar_url,
            p.is_private, p.followers_count, p.following_count, p.posts_count,
            (CASE WHEN f.follower_id IS NOT NULL THEN TRUE ELSE FALSE END) AS is_following
        FROM profiles p
        JOIN users u ON p.id = u.id
        LEFT JOIN follows f ON f.follower_id = $3 AND f.following_id = p.id
        WHERE u.is_active = TRUE
          AND (p.username ILIKE $1 ESCAPE '\\' OR p.display_name ILIKE $1 ESCAPE '\\')
        ORDER BY p.followers_count DESC, p.created_at DESC
        LIMIT $2;
    `;

    const res = await query(sql, [sanitizedPattern, clampedLimit, viewerUserId]);

    return res.rows.map((row) => ({
        id: row.id,
        username: row.username,
        display_name: row.display_name,
        bio: row.bio,
        avatar_url: row.avatar_url,
        is_private: row.is_private,
        followers_count: row.followers_count,
        following_count: row.following_count,
        posts_count: row.posts_count,
        is_following: Boolean(row.is_following)
    }));
};

module.exports = {
    getProfileByUsername,
    updateProfile,
    followUser,
    unfollowUser,
    searchUsers
};
