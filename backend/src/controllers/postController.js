/**
 * Post Controller (Phase 3.3.3)
 * Manages HTTP routing, parameter extraction, and JSON responses for posts endpoints.
 */
const postService = require('../services/postService');
const likeService = require('../services/likeService');
const commentService = require('../services/commentService');

/**
 * Handles POST /api/v1/posts
 * Publishes a new text post for the authenticated user.
 */
const createPost = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { content } = req.body;

        const post = await postService.createPost(userId, { content });

        res.status(201).json({
            message: 'Post created successfully.',
            post
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles GET /api/v1/posts/:id
 * Retrieves a single post by ID with privacy enforcement.
 */
const getPost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const viewerUserId = req.user ? req.user.id : null;

        const post = await postService.getPostById(id, viewerUserId);

        res.status(200).json({
            post
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles PATCH /api/v1/posts/:id
 * Updates an authenticated user's own post content.
 */
const updatePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { content } = req.body;

        const post = await postService.updatePost(id, userId, { content });

        res.status(200).json({
            message: 'Post updated successfully.',
            post
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles DELETE /api/v1/posts/:id
 * Soft-deletes an authenticated user's own post and decrements counter.
 */
const deletePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await postService.deletePost(id, userId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles GET /api/v1/users/:username/posts
 * Retrieves paginated timeline posts for a specific user profile.
 */
const getUserPosts = async (req, res, next) => {
    try {
        const { username } = req.params;
        const { page, limit } = req.query;
        const viewerUserId = req.user ? req.user.id : null;

        const result = await postService.getUserPosts(username, { page, limit }, viewerUserId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles POST /api/v1/posts/:id/like
 * Likes a post for the authenticated user (idempotent).
 */
const likePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await likeService.likePost(id, userId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles DELETE /api/v1/posts/:id/like
 * Unlikes a post for the authenticated user (idempotent).
 */
const unlikePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await likeService.unlikePost(id, userId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles GET /api/v1/posts/:id/likes
 * Retrieves paginated list of users who liked a post.
 */
const getPostLikes = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { page, limit } = req.query;
        const viewerUserId = req.user ? req.user.id : null;

        const result = await likeService.getPostLikes(id, { page, limit }, viewerUserId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles POST /api/v1/posts/:id/comments
 * Creates a comment on a post for the authenticated user.
 */
const createComment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { content } = req.body;

        const result = await commentService.createComment(id, userId, { content });

        res.status(201).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles GET /api/v1/posts/:id/comments
 * Retrieves paginated comments on a post in deterministic chronological order.
 */
const getPostComments = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { page, limit } = req.query;
        const viewerUserId = req.user ? req.user.id : null;

        const result = await commentService.getPostComments(id, { page, limit }, viewerUserId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    createPost,
    getPost,
    updatePost,
    deletePost,
    getUserPosts,
    likePost,
    unlikePost,
    getPostLikes,
    createComment,
    getPostComments
};
