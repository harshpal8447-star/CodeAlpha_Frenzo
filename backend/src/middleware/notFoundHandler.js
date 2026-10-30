/**
 * 404 Not Found middleware
 */
const notFoundHandler = (req, res, next) => {
    res.status(404).json({
        error: {
            code: 'NOT_FOUND',
            message: `Cannot ${req.method} ${req.originalUrl}`
        }
    });
};

module.exports = notFoundHandler;
