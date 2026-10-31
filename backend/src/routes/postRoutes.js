/**
 * Posts Routes (Phase 3.3.3)
 * Mounts post creation, single-post retrieval, editing, and soft deletion.
 */
const express = require('express');
const postController = require('../controllers/postController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { csrfProtection } = require('../middleware/csrfMiddleware');
const { postRateLimiter, likeRateLimiter, commentRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// 1. Create a post (authenticated, CSRF protected, rate limited)
router.post('/', authenticate, csrfProtection, postRateLimiter, postController.createPost);

// 2. Retrieve single post by ID (guest or authenticated)
router.get('/:id', optionalAuthenticate, postController.getPost);

// 3. Edit post content (authenticated author only, CSRF protected)
router.patch('/:id', authenticate, csrfProtection, postController.updatePost);

// 4. Soft-delete post (authenticated author only, CSRF protected)
router.delete('/:id', authenticate, csrfProtection, postController.deletePost);

// 5. Likes System (Phase 3.4.3)
router.post('/:id/like', authenticate, csrfProtection, likeRateLimiter, postController.likePost);
router.delete('/:id/like', authenticate, csrfProtection, postController.unlikePost);
router.post('/:id/unlike', authenticate, csrfProtection, postController.unlikePost);
router.get('/:id/likes', optionalAuthenticate, postController.getPostLikes);

// 6. Comments System (Phase 3.4.3)
router.post('/:id/comments', authenticate, csrfProtection, commentRateLimiter, postController.createComment);
router.get('/:id/comments', optionalAuthenticate, postController.getPostComments);

module.exports = router;
