/**
 * API Rate Limiter Configuration
 * Protects global API endpoints and post publishing against spam and abuse.
 */
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const globalRateLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true, // Return rate limit info in RateLimit-* headers
    legacyHeaders: false, // Disable X-RateLimit-* headers
    message: {
        error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP address. Please try again later.'
        }
    }
});

const postRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute window
    max: 60, // Max 60 post publications per 15 minutes per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'POST_RATE_LIMIT_EXCEEDED',
            message: 'Too many posts published. Please wait a few moments before posting again.'
        }
    }
});

const likeRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute window
    max: config.env === 'test' ? 10000 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'LIKE_RATE_LIMIT_EXCEEDED',
            message: 'Too many like requests. Please wait a few moments.'
        }
    }
});

const commentRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute window
    max: config.env === 'test' ? 10000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: {
            code: 'COMMENT_RATE_LIMIT_EXCEEDED',
            message: 'Too many comments created. Please wait a few moments.'
        }
    }
});

module.exports = {
    globalRateLimiter,
    postRateLimiter,
    likeRateLimiter,
    commentRateLimiter
};
