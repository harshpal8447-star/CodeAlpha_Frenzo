/**
 * Dedicated Rate Limiter for Authentication Endpoints
 * Mitigates credential-stuffing, brute-force login, and spam registration attempts.
 */
const rateLimit = require('express-rate-limit');

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per 15-minute window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'AUTH_RATE_LIMIT_EXCEEDED',
            message: 'Too many authentication attempts from this IP address. Please try again after 15 minutes.'
        }
    }
});

module.exports = {
    authRateLimiter
};
