/**
 * HTTP Cookie Management Helper
 * Centralizes cookie names, security attributes, and serialization options.
 */
const config = require('../config/env');

const COOKIE_NAMES = {
    ACCESS_TOKEN: 'frenzo_access_token',
    REFRESH_TOKEN: 'frenzo_refresh_token',
    CSRF_TOKEN: 'frenzo_csrf_token'
};

const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const CSRF_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Derives common base cookie options according to environment.
 */
const getBaseOptions = () => ({
    secure: config.isProduction,
    sameSite: 'lax'
});

/**
 * Sets both access and refresh authentication cookies on the response.
 * @param {object} res - Express response object
 * @param {object} tokens - { accessToken, rawRefreshToken }
 */
const setAuthCookies = (res, { accessToken, rawRefreshToken }) => {
    const base = getBaseOptions();

    if (accessToken) {
        res.cookie(COOKIE_NAMES.ACCESS_TOKEN, accessToken, {
            ...base,
            httpOnly: true,
            path: '/',
            maxAge: ACCESS_TOKEN_MAX_AGE
        });
    }

    if (rawRefreshToken) {
        res.cookie(COOKIE_NAMES.REFRESH_TOKEN, rawRefreshToken, {
            ...base,
            httpOnly: true,
            path: '/api',
            maxAge: REFRESH_TOKEN_MAX_AGE
        });
    }
};

/**
 * Sets the signed double-submit CSRF cookie (JavaScript readable).
 * @param {object} res - Express response object
 * @param {string} signedCookieValue - `${rawToken}.${signature}`
 */
const setCsrfCookie = (res, signedCookieValue) => {
    res.cookie(COOKIE_NAMES.CSRF_TOKEN, signedCookieValue, {
        ...getBaseOptions(),
        httpOnly: false, // Must be readable by client JS for double-submit header placement
        path: '/',
        maxAge: CSRF_TOKEN_MAX_AGE
    });
};

/**
 * Clears authentication cookies upon logout or session invalidation.
 * @param {object} res - Express response object
 */
const clearAuthCookies = (res) => {
    const base = getBaseOptions();

    res.clearCookie(COOKIE_NAMES.ACCESS_TOKEN, {
        ...base,
        httpOnly: true,
        path: '/'
    });

    res.clearCookie(COOKIE_NAMES.REFRESH_TOKEN, {
        ...base,
        httpOnly: true,
        path: '/api'
    });
};

module.exports = {
    COOKIE_NAMES,
    setAuthCookies,
    setCsrfCookie,
    clearAuthCookies
};
