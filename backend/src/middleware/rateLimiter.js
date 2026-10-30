/**
 * API rate limiter configuration
 */
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const globalRateLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP address. Please try again later.'
        }
    }
});

module.exports = {
    globalRateLimiter
};
