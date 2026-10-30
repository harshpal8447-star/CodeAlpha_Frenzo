/**
 * Signed Double-Submit CSRF Protection Middleware
 * Defends against Cross-Site Request Forgery via HMAC-signed cookie verification
 * and Origin / Referer validation.
 */
const config = require('../config/env');
const { generateCsrfToken, verifyCsrfToken } = require('../utils/crypto');
const { COOKIE_NAMES, setCsrfCookie } = require('../utils/cookieHelper');

/**
 * Validates Origin or Referer header against allowed CORS origins.
 */
const validateOrigin = (req) => {
    const origin = req.headers['origin'];
    const referer = req.headers['referer'];

    const target = origin || referer;
    if (!target) {
        // Non-browser / same-origin requests without Origin/Referer in development
        return true;
    }

    try {
        const parsed = new URL(target).origin;
        return config.corsAllowedOrigins.includes(parsed);
    } catch {
        return false;
    }
};

/**
 * Ensures a CSRF cookie exists on safe requests and verifies tokens on mutations.
 */
const csrfProtection = (req, res, next) => {
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());

    // 1. Ensure cookie exists
    const currentCookie = req.cookies[COOKIE_NAMES.CSRF_TOKEN];
    if (!currentCookie) {
        const { signedCookieValue } = generateCsrfToken();
        setCsrfCookie(res, signedCookieValue);
        // Expose in req for immediate downstream handler access if needed
        req.csrfSignedValue = signedCookieValue;
    }

    // 2. Safe methods are exempt from token validation
    if (isSafeMethod) {
        return next();
    }

    // 3. Mutation methods: Validate Origin/Referer
    if (!validateOrigin(req)) {
        return res.status(403).json({
            error: {
                code: 'INVALID_ORIGIN',
                message: 'Cross-origin request rejected by CSRF policy.'
            }
        });
    }

    // 4. Validate double-submit token
    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = req.cookies[COOKIE_NAMES.CSRF_TOKEN] || req.csrfSignedValue;

    if (!headerToken || !cookieToken) {
        return res.status(403).json({
            error: {
                code: 'CSRF_VERIFICATION_FAILED',
                message: 'Invalid or missing CSRF token.'
            }
        });
    }

    const isValid = verifyCsrfToken(headerToken, cookieToken);
    if (!isValid) {
        return res.status(403).json({
            error: {
                code: 'CSRF_VERIFICATION_FAILED',
                message: 'Invalid or missing CSRF token.'
            }
        });
    }

    next();
};

module.exports = {
    csrfProtection
};
