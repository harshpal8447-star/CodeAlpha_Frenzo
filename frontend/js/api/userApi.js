/**
 * User & Social Graph API Consumer (Phase 3.2)
 * Provides client methods for profile retrieval, profile updates,
 * following/unfollowing, and parameterized user discovery.
 */
import { apiClient } from './client.js';
import { fetchCsrfToken } from './authApi.js';

/**
 * Retrieves public profile by username.
 * @param {string} username
 * @returns {Promise<object>} Profile object
 */
export const getProfile = async (username) => {
    const data = await apiClient(`/users/${encodeURIComponent(username)}`, { method: 'GET' });
    return data.profile;
};

/**
 * Updates authenticated user's own profile.
 * @param {object} payload - { display_name, username, bio, website }
 * @returns {Promise<object>} Updated profile object
 */
export const updateProfile = async (payload) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient('/users/me', {
        method: 'PATCH',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: payload
    });
    return data.profile;
};

/**
 * Follows target user.
 * @param {string} username
 * @returns {Promise<object>} { message, is_following, followed, target_followers_count }
 */
export const followUser = async (username) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/users/${encodeURIComponent(username)}/follow`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    return data;
};

/**
 * Unfollows target user.
 * @param {string} username
 * @returns {Promise<object>} { message, is_following, unfollowed, target_followers_count }
 */
export const unfollowUser = async (username) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/users/${encodeURIComponent(username)}/follow`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    return data;
};

/**
 * Searches users by query term.
 * @param {string} queryTerm
 * @param {number} limit
 * @returns {Promise<Array>} Array of user preview objects
 */
export const searchUsers = async (queryTerm, limit = 20) => {
    if (!queryTerm || !queryTerm.trim()) {
        return [];
    }
    const data = await apiClient(`/users/search?q=${encodeURIComponent(queryTerm.trim())}&limit=${limit}`, {
        method: 'GET'
    });
    return data.users || [];
};
