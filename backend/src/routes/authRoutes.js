/**
 * Authentication Route Definitions
 * Mounts public auth actions, session rotation, CSRF token issuance, and protected identity routes.
 */
const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const { csrfProtection } = require('../middleware/csrfMiddleware');
const { authRateLimiter } = require('../middleware/authRateLimiter');

const router = express.Router();

// Public CSRF token acquisition endpoint (safe GET method)
router.get('/csrf', authController.getCsrfToken);

// Core Authentication Endpoints (enforced with rate limiting & signed double-submit CSRF)
router.post('/register', authRateLimiter, csrfProtection, authController.register);
router.post('/login', authRateLimiter, csrfProtection, authController.login);
router.post('/refresh', csrfProtection, authController.refresh);
router.post('/logout', csrfProtection, authController.logout);

// Protected Identity Endpoint
router.get('/me', authenticate, authController.me);

module.exports = router;
