/**
 * Posts API Consumer (Phase 3.3.4)
 * Client methods for creating, retrieving, updating, and deleting posts,
 * and fetching user profile post timelines.
 */
import { apiClient } from './client.js';
import { fetchCsrfToken } from './authApi.js';

/**
 * Publishes a new text post.
 * @param {object} param0 - { content: string }
 * @returns {Promise<object>} Created post object
 */
export const createPost = async ({ content }) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient('/posts', {
        method: 'POST',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: { content }
    });
    return data.post;
};

/**
 * Retrieves a single post by ID.
 * @param {string} id - Post UUID
 * @returns {Promise<object>} Post object
 */
export const getPost = async (id) => {
    const data = await apiClient(`/posts/${encodeURIComponent(id)}`, {
        method: 'GET'
    });
    return data.post;
};

/**
 * Updates an authenticated user's own post content.
 * @param {string} id - Post UUID
 * @param {object} param1 - { content: string }
 * @returns {Promise<object>} Updated post object
 */
export const updatePost = async (id, { content }) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/posts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: { content }
    });
    return data.post;
};

/**
 * Soft-deletes an authenticated user's own post.
 * @param {string} id - Post UUID
 * @returns {Promise<object>} { message: string, post_id: string }
 */
export const deletePost = async (id) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/posts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    return data;
};

/**
 * Retrieves paginated post timeline for a specific username.
 * @param {string} username - User handle
 * @param {object} options - { page: number, limit: number }
 * @returns {Promise<object>} { posts: Array, pagination: object }
 */
export const getUserPosts = async (username, { page = 1, limit = 20 } = {}) => {
    const query = new URLSearchParams();
    if (page) query.append('page', page);
    if (limit) query.append('limit', limit);
    const qs = query.toString() ? `?${query.toString()}` : '';

    const data = await apiClient(`/users/${encodeURIComponent(username)}/posts${qs}`, {
        method: 'GET'
    });
    return data;
};
