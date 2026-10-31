/**
 * Environment-driven CORS middleware configuration
 */
const cors = require('cors');
const config = require('../config/env');

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server) in development
        if (!origin) {
            return callback(null, true);
        }

        if (config.corsAllowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        const error = new Error(`CORS blocked: Origin ${origin} is not allowed by policy.`);
        error.status = 403;
        error.code = 'CORS_BLOCKED';
        return callback(error, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Frenzo-Request',
        'X-CSRF-Token'
    ],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400 // 24 hours
};

module.exports = cors(corsOptions);
