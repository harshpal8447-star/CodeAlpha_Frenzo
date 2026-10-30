/**
 * Centralized application error handler
 */
const config = require('../config/env');

const errorHandler = (err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    // Log unexpected 5xx server errors
    if (!isClientError) {
        console.error('Unhandled Server Error:', {
            message: err.message,
            stack: err.stack,
            url: req.originalUrl,
            method: req.method
        });
    }

    res.status(statusCode).json({
        error: {
            code: err.code || (statusCode === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR'),
            message: isClientError ? err.message : 'An unexpected error occurred.',
            ...(config.env === 'development' && !isClientError ? { details: err.message, stack: err.stack } : {})
        }
    });
};

module.exports = errorHandler;
