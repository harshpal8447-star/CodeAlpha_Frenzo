/**
 * User & Social Graph Routes (Phase 3.2)
 * Mounts profile retrieval, profile updates, follower/following operations, and user discovery.
 */
const express = require('express');
const userController = require('../controllers/userController');
const { authenticate, optionalAuthenticate } = require('../middleware/authMiddleware');
const { csrfProtection } = require('../middleware/csrfMiddleware');

const router = express.Router();

// 1. User Discovery Search (mounted before :username to prevent route shadowing)
router.get('/search', optionalAuthenticate, userController.searchUsers);

// 2. Profile Management
router.patch('/me', authenticate, csrfProtection, userController.updateProfile);

// 3. Public Profile Retrieval
router.get('/:username', optionalAuthenticate, userController.getProfile);

// 4. Social Graph Connections (Follow / Unfollow)
router.post('/:username/follow', authenticate, csrfProtection, userController.followUser);
router.delete('/:username/follow', authenticate, csrfProtection, userController.unfollowUser);
router.post('/:username/unfollow', authenticate, csrfProtection, userController.unfollowUser);

module.exports = router;
