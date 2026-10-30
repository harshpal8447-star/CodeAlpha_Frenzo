/**
 * Authentication Middleware
 * Validates short-lived access JWTs from HttpOnly cookies or Bearer headers.
 */
const { verifyAccessToken } = require('../utils/crypto');
const { COOKIE_NAMES } = require('../utils/cookieHelper');

/**
 * Extracts and verifies the access token, attaching decoded claims to req.user.
 */
const authenticate = (req, res, next) => {
    let token = req.cookies[COOKIE_NAMES.ACCESS_TOKEN];

    // Optional Bearer token header support for CLI / API test clients
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            error: {
                code: 'UNAUTHORIZED',
                message: 'Authentication required. No active session token found.'
            }
        });
    }

    try {
        const decoded = verifyAccessToken(token);
        req.user = {
            id: decoded.sub,
            email: decoded.email,
            username: decoded.username
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: {
                    code: 'TOKEN_EXPIRED',
                    message: 'Access token has expired. Please refresh your session.'
                }
            });
        }
        return res.status(401).json({
            error: {
                code: 'INVALID_TOKEN',
                message: 'Invalid or corrupted access token.'
            }
        });
    }
};

module.exports = {
    authenticate
};
