/**
 * Authentication Business Logic Service
 * Implements user registration, credential verification, token family rotation,
 * and session lifecycle management using PostgreSQL transactions.
 */
const crypto = require('crypto');
const { query, withTransaction } = require('../config/database');
const {
    hashPassword,
    verifyPassword,
    generateRefreshToken,
    hashToken,
    signAccessToken
} = require('../utils/crypto');

// Dummy hash for constant-time comparison when user is not found (mitigates timing attacks)
const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,t=3,p=4$eVRJdW5kZWZpbmVkU2FsdA$eUZyZW56b1BsYXRmb3JtRHVtbXlIYXNoVmFsdWVGb3JUaW1pbmdTYWZldHkxMjM0';

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

class AppError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

/**
 * Validates and normalizes registration inputs.
 */
const validateRegistrationInput = ({ email, username, password, display_name }) => {
    if (!email || typeof email !== 'string') {
        throw new AppError('INVALID_EMAIL', 'A valid email address is required.', 400);
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(normalizedEmail) || normalizedEmail.length > 255) {
        throw new AppError('INVALID_EMAIL', 'Please provide a valid email address.', 400);
    }

    if (!username || typeof username !== 'string') {
        throw new AppError('INVALID_USERNAME', 'A username is required.', 400);
    }
    const normalizedUsername = username.trim().toLowerCase();
    if (!USERNAME_REGEX.test(normalizedUsername)) {
        throw new AppError('INVALID_USERNAME', 'Username must be 3-30 characters containing only letters, numbers, and underscores.', 400);
    }

    if (!password || typeof password !== 'string') {
        throw new AppError('INVALID_PASSWORD', 'A password is required.', 400);
    }
    if (password.length < 8 || password.length > 128) {
        throw new AppError('INVALID_PASSWORD', 'Password must be between 8 and 128 characters.', 400);
    }

    let finalDisplayName = (display_name && typeof display_name === 'string') ? display_name.trim() : normalizedUsername;
    if (finalDisplayName.length === 0) {
        finalDisplayName = normalizedUsername;
    }
    if (finalDisplayName.length > 60) {
        throw new AppError('INVALID_DISPLAY_NAME', 'Display name cannot exceed 60 characters.', 400);
    }

    return {
        normalizedEmail,
        normalizedUsername,
        finalDisplayName
    };
};

/**
 * Registers a new user, creates their profile, and establishes their first session in a single transaction.
 */
const registerUser = async ({ email, username, password, display_name, userAgent, ipAddress }) => {
    const { normalizedEmail, normalizedUsername, finalDisplayName } = validateRegistrationInput({
        email,
        username,
        password,
        display_name
    });

    // Check for collisions prior to expensive hashing
    const emailCheck = await query('SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1;', [normalizedEmail]);
    if (emailCheck.rows.length > 0) {
        throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email address already exists.', 409);
    }

    const usernameCheck = await query('SELECT id FROM profiles WHERE LOWER(username) = $1 LIMIT 1;', [normalizedUsername]);
    if (usernameCheck.rows.length > 0) {
        throw new AppError('USERNAME_ALREADY_EXISTS', 'This username is already taken. Please choose another.', 409);
    }

    // Hash password with Argon2id
    const passwordHash = await hashPassword(password);

    // Generate initial session credentials
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Atomic execution of user, profile, and refresh token creation
    const createdData = await withTransaction(async (client) => {
        // 1. Insert user
        const userRes = await client.query(
            `INSERT INTO users (email, password_hash, is_active, email_verified)
             VALUES ($1, $2, TRUE, FALSE)
             RETURNING id, email, is_active, email_verified, created_at;`,
            [normalizedEmail, passwordHash]
        );
        const newUser = userRes.rows[0];

        // 2. Insert profile
        const profileRes = await client.query(
            `INSERT INTO profiles (id, username, display_name)
             VALUES ($1, $2, $3)
             RETURNING id, username, display_name, bio, avatar_url, banner_url, website, is_private, followers_count, following_count, posts_count, created_at;`,
            [newUser.id, normalizedUsername, finalDisplayName]
        );
        const newProfile = profileRes.rows[0];

        // 3. Insert refresh token session
        await client.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6);`,
            [newUser.id, tokenHash, familyId, refreshExpiresAt, userAgent || null, ipAddress || null]
        );

        return { user: newUser, profile: newProfile };
    });

    // Sign 15-minute access JWT
    const accessToken = signAccessToken({
        sub: createdData.user.id,
        email: createdData.user.email,
        username: createdData.profile.username
    });

    return {
        user: {
            id: createdData.user.id,
            email: createdData.user.email,
            username: createdData.profile.username,
            display_name: createdData.profile.display_name,
            bio: createdData.profile.bio,
            avatar_url: createdData.profile.avatar_url,
            banner_url: createdData.profile.banner_url,
            website: createdData.profile.website,
            is_private: createdData.profile.is_private,
            followers_count: createdData.profile.followers_count,
            following_count: createdData.profile.following_count,
            posts_count: createdData.profile.posts_count,
            created_at: createdData.user.created_at
        },
        accessToken,
        rawRefreshToken
    };
};

/**
 * Authenticates user credentials and establishes a new token family session.
 */
const loginUser = async ({ identifier, password, userAgent, ipAddress }) => {
    if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email, username, or password.', 401);
    }

    const normalized = identifier.trim().toLowerCase();

    // Query user and profile matching either email or username
    const res = await query(
        `SELECT 
            u.id, u.email, u.password_hash, u.is_active, u.email_verified, u.created_at,
            p.username, p.display_name, p.bio, p.avatar_url, p.banner_url, p.website,
            p.is_private, p.followers_count, p.following_count, p.posts_count
         FROM users u
         JOIN profiles p ON u.id = p.id
         WHERE LOWER(u.email) = $1 OR LOWER(p.username) = $1
         LIMIT 1;`,
        [normalized]
    );

    const user = res.rows[0];

    // Mitigate account enumeration: always run password verification
    if (!user || !user.is_active) {
        await verifyPassword(DUMMY_ARGON2_HASH, password);
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email, username, or password.', 401);
    }

    const isMatch = await verifyPassword(user.password_hash, password);
    if (!isMatch) {
        throw new AppError('INVALID_CREDENTIALS', 'Invalid email, username, or password.', 401);
    }

    // Generate new refresh token family session
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const familyId = crypto.randomUUID();
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [user.id, tokenHash, familyId, refreshExpiresAt, userAgent || null, ipAddress || null]
    );

    const accessToken = signAccessToken({
        sub: user.id,
        email: user.email,
        username: user.username
    });

    return {
        user: {
            id: user.id,
            email: user.email,
            username: user.username,
            display_name: user.display_name,
            bio: user.bio,
            avatar_url: user.avatar_url,
            banner_url: user.banner_url,
            website: user.website,
            is_private: user.is_private,
            followers_count: user.followers_count,
            following_count: user.following_count,
            posts_count: user.posts_count,
            created_at: user.created_at
        },
        accessToken,
        rawRefreshToken
    };
};

/**
 * Rotates a refresh token using row-level locking (SELECT FOR UPDATE) and revokes the family on reuse.
 */
const rotateRefreshToken = async ({ rawRefreshToken, userAgent, ipAddress }) => {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
        throw new AppError('UNAUTHORIZED', 'No refresh token provided.', 401);
    }

    const tokenHash = hashToken(rawRefreshToken);

    const result = await withTransaction(async (client) => {
        // Row-level lock on the presented refresh token
        const res = await client.query(
            `SELECT 
                rt.id, rt.user_id, rt.token_hash, rt.family_id, rt.is_revoked, rt.expires_at,
                u.email, u.is_active, p.username, p.display_name, p.avatar_url
             FROM refresh_tokens rt
             JOIN users u ON rt.user_id = u.id
             JOIN profiles p ON rt.user_id = p.id
             WHERE rt.token_hash = $1
             FOR UPDATE OF rt;`,
            [tokenHash]
        );

        const currentToken = res.rows[0];

        if (!currentToken) {
            throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid refresh token.', 401);
        }

        // Reuse Detection: A revoked token in this family was presented!
        if (currentToken.is_revoked) {
            // Compromise detected: Revoke all tokens belonging to this family
            await client.query(
                `UPDATE refresh_tokens 
                 SET is_revoked = TRUE, revoked_at = NOW() 
                 WHERE family_id = $1;`,
                [currentToken.family_id]
            );
            return {
                compromised: true
            };
        }

        // Expiration or user inactivity check
        if (new Date(currentToken.expires_at) < new Date() || !currentToken.is_active) {
            throw new AppError('REFRESH_TOKEN_EXPIRED', 'Refresh token has expired. Please log in again.', 401);
        }

        // 1. Revoke the presented token
        await client.query(
            `UPDATE refresh_tokens 
             SET is_revoked = TRUE, revoked_at = NOW() 
             WHERE id = $1;`,
            [currentToken.id]
        );

        // 2. Issue a new replacement token in the SAME family
        const newRawRefreshToken = generateRefreshToken();
        const newTokenHash = hashToken(newRawRefreshToken);
        const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await client.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6);`,
            [currentToken.user_id, newTokenHash, currentToken.family_id, newExpiresAt, userAgent || null, ipAddress || null]
        );

        // 3. Issue fresh access token
        const newAccessToken = signAccessToken({
            sub: currentToken.user_id,
            email: currentToken.email,
            username: currentToken.username
        });

        return {
            compromised: false,
            user: {
                id: currentToken.user_id,
                email: currentToken.email,
                username: currentToken.username,
                display_name: currentToken.display_name,
                avatar_url: currentToken.avatar_url
            },
            accessToken: newAccessToken,
            rawRefreshToken: newRawRefreshToken
        };
    });

    if (result.compromised) {
        throw new AppError(
            'REFRESH_TOKEN_REUSED',
            'Compromised or reused session token detected. All sessions in this family have been terminated.',
            401
        );
    }

    return result;
};

/**
 * Revokes the specific refresh token session associated with a logout.
 */
const logoutUser = async ({ rawRefreshToken }) => {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
        return;
    }
    const tokenHash = hashToken(rawRefreshToken);
    await query(
        `UPDATE refresh_tokens 
         SET is_revoked = TRUE, revoked_at = NOW() 
         WHERE token_hash = $1 AND is_revoked = FALSE;`,
        [tokenHash]
    );
};

/**
 * Retrieves the full profile of an authenticated user by ID.
 */
const getCurrentUser = async (userId) => {
    const res = await query(
        `SELECT 
            u.id, u.email, u.is_active, u.email_verified, u.created_at,
            p.username, p.display_name, p.bio, p.avatar_url, p.banner_url, p.website,
            p.is_private, p.followers_count, p.following_count, p.posts_count
         FROM users u
         JOIN profiles p ON u.id = p.id
         WHERE u.id = $1 AND u.is_active = TRUE
         LIMIT 1;`,
        [userId]
    );

    const user = res.rows[0];
    if (!user) {
        throw new AppError('USER_NOT_FOUND', 'User account not found or has been deactivated.', 404);
    }

    return user;
};

module.exports = {
    AppError,
    registerUser,
    loginUser,
    rotateRefreshToken,
    logoutUser,
    getCurrentUser
};
