/**
 * Posts Routes (Phase 3.3.3)
 * Mounts post creation, single-post retrieval, editing, and soft deletion.
 */
const express = require('express');
const postController = require('../controllers/postController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { csrfProtection } = require('../middleware/csrfMiddleware');
const { postRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// 1. Create a post (authenticated, CSRF protected, rate limited)
router.post('/', authenticate, csrfProtection, postRateLimiter, postController.createPost);

// 2. Retrieve single post by ID (guest or authenticated)
router.get('/:id', optionalAuthenticate, postController.getPost);

// 3. Edit post content (authenticated author only, CSRF protected)
router.patch('/:id', authenticate, csrfProtection, postController.updatePost);

// 4. Soft-delete post (authenticated author only, CSRF protected)
router.delete('/:id', authenticate, csrfProtection, postController.deletePost);

module.exports = router;
