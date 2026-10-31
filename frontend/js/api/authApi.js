/**
 * Authentication API Consumer
 * Interacts with Frenzo backend authentication endpoints:
 * - CSRF token acquisition
 * - User registration & login
 * - Session status check (/me)
 * - User logout
 */
import { apiClient, ApiError } from './client.js';

let cachedCsrfToken = null;

/**
 * Fetches a cryptographically signed CSRF token from the backend.
 * @param {boolean} forceRefresh - If true, bypasses in-memory cache
 * @returns {Promise<string>} Raw CSRF token for header inclusion
 */
export const fetchCsrfToken = async (forceRefresh = false) => {
    if (cachedCsrfToken && !forceRefresh) {
        return cachedCsrfToken;
    }
    const data = await apiClient('/auth/csrf', { method: 'GET' });
    cachedCsrfToken = data.csrfToken;
    return cachedCsrfToken;
};

/**
 * Registers a new user account with display name, username, email, and password.
 * @param {object} payload - { email, username, password, display_name }
 * @returns {Promise<object>} { message, user }
 */
export const register = async ({ email, username, password, display_name }) => {
    const csrfToken = await fetchCsrfToken(true);
    const data = await apiClient('/auth/register', {
        method: 'POST',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: {
            email,
            username,
            password,
            display_name: display_name || undefined
        }
    });
    return data;
};

/**
 * Authenticates user credentials using email or username identifier.
 * @param {object} payload - { identifier, password }
 * @returns {Promise<object>} { message, user }
 */
export const login = async ({ identifier, password }) => {
    const csrfToken = await fetchCsrfToken(true);
    const data = await apiClient('/auth/login', {
        method: 'POST',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: {
            identifier,
            password
        }
    });
    return data;
};

/**
 * Retrieves the currently authenticated user's session profile.
 * @returns {Promise<object|null>} User profile object, or null if unauthenticated
 */
export const getCurrentUser = async () => {
    try {
        const data = await apiClient('/auth/me', { method: 'GET' });
        return data.user;
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            return null;
        }
        throw err;
    }
};

/**
 * Terminates the active session and clears cookies on the backend.
 * @returns {Promise<object>} { message }
 */
export const logout = async () => {
    const csrfToken = await fetchCsrfToken(false).catch(() => null);
    try {
        const data = await apiClient('/auth/logout', {
            method: 'POST',
            headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {}
        });
        cachedCsrfToken = null;
        return data;
    } catch (err) {
        cachedCsrfToken = null;
        throw err;
    }
};
