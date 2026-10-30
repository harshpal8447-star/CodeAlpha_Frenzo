/**
 * Cryptographic Utility Functions
 * Implements Argon2id password hashing, SHA-256 token hashing, JWT issuance/verification,
 * and cryptographically signed double-submit CSRF token generation and validation.
 */
const crypto = require('crypto');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

// Approved Argon2id configuration (Phase 2.1 architecture)
const ARGON2_CONFIG = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,       // 3 iterations
    parallelism: 4     // 4 threads
};

/**
 * Hashes a plaintext password using Argon2id with production parameters.
 * @param {string} password - Plaintext password
 * @returns {Promise<string>} Argon2id hash string
 */
const hashPassword = async (password) => {
    return await argon2.hash(password, ARGON2_CONFIG);
};

/**
 * Verifies a plaintext password against an Argon2id hash in constant time.
 * @param {string} hash - Argon2id hash string
 * @param {string} password - Plaintext password to verify
 * @returns {Promise<boolean>} True if match, false otherwise
 */
const verifyPassword = async (hash, password) => {
    try {
        return await argon2.verify(hash, password);
    } catch {
        return false;
    }
};

/**
 * Generates an opaque, cryptographically secure 32-byte refresh token (64 hex characters).
 * @returns {string} 64-char hex string
 */
const generateRefreshToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Computes a SHA-256 hash of an opaque token for secure database persistence.
 * @param {string} token - Raw token string
 * @returns {string} SHA-256 hex string
 */
const hashToken = (token) => {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
};

/**
 * Signs a short-lived access JWT (15 minutes by default).
 * @param {object} payload - Claims to embed ({ sub, email, username })
 * @returns {string} Signed JWT
 */
const signAccessToken = (payload) => {
    return jwt.sign(payload, config.security.jwtAccessSecret, {
        expiresIn: config.security.jwtAccessExpiresIn,
        algorithm: 'HS256'
    });
};

/**
 * Verifies and decodes an access JWT.
 * @param {string} token - JWT string
 * @returns {object} Decoded claims
 */
const verifyAccessToken = (token) => {
    return jwt.verify(token, config.security.jwtAccessSecret, {
        algorithms: ['HS256']
    });
};

/**
 * Generates a signed double-submit CSRF token and signed cookie value.
 * @returns {{ rawToken: string, signedCookieValue: string }}
 */
const generateCsrfToken = () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const signature = crypto
        .createHmac('sha256', config.security.csrfSecret)
        .update(rawToken)
        .digest('hex');
    return {
        rawToken,
        signedCookieValue: `${rawToken}.${signature}`
    };
};

/**
 * Validates a submitted CSRF token against the signed cookie value using timing-safe comparison.
 * @param {string} headerToken - Raw token provided in X-CSRF-Token header
 * @param {string} signedCookieValue - Value of the frenzo_csrf_token cookie (`${rawToken}.${signature}`)
 * @returns {boolean} True if token and HMAC signature are valid and match
 */
const verifyCsrfToken = (headerToken, signedCookieValue) => {
    if (!headerToken || !signedCookieValue || typeof headerToken !== 'string' || typeof signedCookieValue !== 'string') {
        return false;
    }

    const dotIndex = signedCookieValue.indexOf('.');
    if (dotIndex === -1) {
        return false;
    }

    const cookieRawToken = signedCookieValue.substring(0, dotIndex);
    const cookieSignature = signedCookieValue.substring(dotIndex + 1);

    // Verify HMAC signature of the cookie's raw token
    const expectedSignature = crypto
        .createHmac('sha256', config.security.csrfSecret)
        .update(cookieRawToken)
        .digest('hex');

    const sigBufferA = Buffer.from(cookieSignature, 'utf8');
    const sigBufferB = Buffer.from(expectedSignature, 'utf8');
    if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
        return false;
    }

    // Verify that the header token matches the cookie raw token
    const tokenBufferA = Buffer.from(headerToken, 'utf8');
    const tokenBufferB = Buffer.from(cookieRawToken, 'utf8');
    if (tokenBufferA.length !== tokenBufferB.length || !crypto.timingSafeEqual(tokenBufferA, tokenBufferB)) {
        return false;
    }

    return true;
};

module.exports = {
    ARGON2_CONFIG,
    hashPassword,
    verifyPassword,
    generateRefreshToken,
    hashToken,
    signAccessToken,
    verifyAccessToken,
    generateCsrfToken,
    verifyCsrfToken
};
