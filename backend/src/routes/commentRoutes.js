/**
 * Comments Routes (Phase 3.4.3)
 * Mounts comment editing and deletion endpoints.
 */
const express = require('express');
const commentController = require('../controllers/commentController');
const { authenticate } = require('../middleware/authMiddleware');
const { csrfProtection } = require('../middleware/csrfMiddleware');

const router = express.Router();

// 1. Edit comment content (authenticated comment author only, CSRF protected)
router.patch('/:id', authenticate, csrfProtection, commentController.updateComment);

// 2. Soft-delete comment (authenticated comment author OR parent post author, CSRF protected)
router.delete('/:id', authenticate, csrfProtection, commentController.deleteComment);

module.exports = router;
