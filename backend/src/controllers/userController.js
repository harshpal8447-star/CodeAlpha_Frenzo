/**
 * User & Profile Controller (Phase 3.2)
 * Manages HTTP routing, parameters, authorization checks, and responses for profile & social features.
 */
const userService = require('../services/userService');

/**
 * Handles GET /api/v1/users/search
 */
const searchUsers = async (req, res, next) => {
    try {
        const queryTerm = req.query.q || '';
        const limit = req.query.limit || 20;
        const viewerUserId = req.user ? req.user.id : null;

        const results = await userService.searchUsers(queryTerm, limit, viewerUserId);
        res.status(200).json({
            users: results,
            count: results.length
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles GET /api/v1/users/:username
 */
const getProfile = async (req, res, next) => {
    try {
        const { username } = req.params;
        const viewerUserId = req.user ? req.user.id : null;

        const profile = await userService.getProfileByUsername(username, viewerUserId);
        res.status(200).json({
            profile
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles PATCH /api/v1/users/me
 */
const updateProfile = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { display_name, username, bio, website } = req.body;

        const updated = await userService.updateProfile(userId, {
            display_name,
            username,
            bio,
            website
        });

        res.status(200).json({
            message: 'Profile updated successfully.',
            profile: updated
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles POST /api/v1/users/:username/follow
 */
const followUser = async (req, res, next) => {
    try {
        const followerId = req.user.id;
        const { username } = req.params;

        const result = await userService.followUser(followerId, username);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles DELETE /api/v1/users/:username/follow (and POST /api/v1/users/:username/unfollow)
 */
const unfollowUser = async (req, res, next) => {
    try {
        const followerId = req.user.id;
        const { username } = req.params;

        const result = await userService.unfollowUser(followerId, username);
        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    searchUsers,
    getProfile,
    updateProfile,
    followUser,
    unfollowUser
};
