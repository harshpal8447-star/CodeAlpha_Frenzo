/**
 * Authentication Controller
 * Manages HTTP transport, cookie lifecycle, response envelopes, and error delegation.
 */
const authService = require('../services/authService');
const { COOKIE_NAMES, setAuthCookies, clearAuthCookies, setCsrfCookie } = require('../utils/cookieHelper');
const { generateCsrfToken } = require('../utils/crypto');

/**
 * Handles new user registration.
 */
const register = async (req, res, next) => {
    try {
        const { email, username, password, display_name } = req.body;
        const userAgent = req.headers['user-agent'];
        const ipAddress = req.ip;

        const result = await authService.registerUser({
            email,
            username,
            password,
            display_name,
            userAgent,
            ipAddress
        });

        setAuthCookies(res, {
            accessToken: result.accessToken,
            rawRefreshToken: result.rawRefreshToken
        });

        res.status(201).json({
            message: 'User registered successfully.',
            user: result.user
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles user authentication / login.
 */
const login = async (req, res, next) => {
    try {
        const { identifier, password } = req.body;
        const userAgent = req.headers['user-agent'];
        const ipAddress = req.ip;

        const result = await authService.loginUser({
            identifier,
            password,
            userAgent,
            ipAddress
        });

        setAuthCookies(res, {
            accessToken: result.accessToken,
            rawRefreshToken: result.rawRefreshToken
        });

        res.status(200).json({
            message: 'Login successful.',
            user: result.user
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Handles session token rotation.
 */
const refresh = async (req, res, next) => {
    try {
        const rawRefreshToken = req.cookies[COOKIE_NAMES.REFRESH_TOKEN];
        const userAgent = req.headers['user-agent'];
        const ipAddress = req.ip;

        const result = await authService.rotateRefreshToken({
            rawRefreshToken,
            userAgent,
            ipAddress
        });

        setAuthCookies(res, {
            accessToken: result.accessToken,
            rawRefreshToken: result.rawRefreshToken
        });

        res.status(200).json({
            message: 'Session refreshed successfully.',
            user: result.user
        });
    } catch (err) {
        // If refresh token reuse or expiration occurred, clear cookies
        if (err.code === 'REFRESH_TOKEN_REUSED' || err.code === 'REFRESH_TOKEN_EXPIRED') {
            clearAuthCookies(res);
        }
        next(err);
    }
};

/**
 * Handles user logout and session revocation.
 */
const logout = async (req, res, next) => {
    try {
        const rawRefreshToken = req.cookies[COOKIE_NAMES.REFRESH_TOKEN];
        await authService.logoutUser({ rawRefreshToken });
        clearAuthCookies(res);

        res.status(200).json({
            message: 'Logout successful.'
        });
    } catch (err) {
        clearAuthCookies(res);
        next(err);
    }
};

/**
 * Returns current authenticated user's profile.
 */
const me = async (req, res, next) => {
    try {
        const user = await authService.getCurrentUser(req.user.id);
        res.status(200).json({
            user
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Provides a fresh CSRF token and sets the signed cookie.
 */
const getCsrfToken = (req, res) => {
    const existing = req.cookies[COOKIE_NAMES.CSRF_TOKEN];
    let rawToken;

    if (existing && existing.includes('.')) {
        rawToken = existing.split('.')[0];
    } else {
        const generated = generateCsrfToken();
        rawToken = generated.rawToken;
        setCsrfCookie(res, generated.signedCookieValue);
    }

    res.status(200).json({
        csrfToken: rawToken
    });
};

module.exports = {
    register,
    login,
    refresh,
    logout,
    me,
    getCsrfToken
};
