/**
 * Comment Controller (Phase 3.4.3)
 * Manages HTTP routing, parameter extraction, and JSON responses for comment mutations.
 */
const commentService = require('../services/commentService');

/**
 * Handles PATCH /api/v1/comments/:id
 * Updates an authenticated author's comment content.
 */
const updateComment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { content } = req.body;

        const result = await commentService.updateComment(id, userId, { content });

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

/**
 * Handles DELETE /api/v1/comments/:id
 * Soft-deletes a comment (authorized for comment author or parent post author).
 */
const deleteComment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await commentService.deleteComment(id, userId);

        res.status(200).json(result);
    } catch (err) {
        next(err);
    }
};

module.exports = {
    updateComment,
    deleteComment
};
