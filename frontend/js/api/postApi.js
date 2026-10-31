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

/**
 * Likes a post for the authenticated user.
 * @param {string} postId - Post UUID
 * @returns {Promise<object>} { message: string, liked: boolean, likes_count: number }
 */
export const likePost = async (postId) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/posts/${encodeURIComponent(postId)}/like`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    return data;
};

/**
 * Unlikes a post for the authenticated user.
 * @param {string} postId - Post UUID
 * @returns {Promise<object>} { message: string, liked: boolean, likes_count: number }
 */
export const unlikePost = async (postId) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/posts/${encodeURIComponent(postId)}/like`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    return data;
};

/**
 * Retrieves paginated list of users who liked a post.
 * @param {string} postId - Post UUID
 * @param {object} options - { page: number, limit: number }
 * @returns {Promise<object>} { likes: Array, pagination: object }
 */
export const getPostLikes = async (postId, { page = 1, limit = 20 } = {}) => {
    const query = new URLSearchParams();
    if (page) query.append('page', page);
    if (limit) query.append('limit', limit);
    const qs = query.toString() ? `?${query.toString()}` : '';

    const data = await apiClient(`/posts/${encodeURIComponent(postId)}/likes${qs}`, {
        method: 'GET'
    });
    return data;
};

/**
 * Retrieves paginated comments for a post in deterministic order.
 * @param {string} postId - Post UUID
 * @param {object} options - { page: number, limit: number }
 * @returns {Promise<object>} { comments: Array, pagination: object }
 */
export const getPostComments = async (postId, { page = 1, limit = 20 } = {}) => {
    const query = new URLSearchParams();
    if (page) query.append('page', page);
    if (limit) query.append('limit', limit);
    const qs = query.toString() ? `?${query.toString()}` : '';

    const data = await apiClient(`/posts/${encodeURIComponent(postId)}/comments${qs}`, {
        method: 'GET'
    });
    return data;
};

/**
 * Publishes a new comment on a post.
 * @param {string} postId - Post UUID
 * @param {object} param1 - { content: string }
 * @returns {Promise<object>} Created comment object
 */
export const createComment = async (postId, { content }) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: { content }
    });
    return data.comment;
};

/**
 * Updates an authenticated author's comment content.
 * @param {string} commentId - Comment UUID
 * @param {object} param1 - { content: string }
 * @returns {Promise<object>} Updated comment object
 */
export const updateComment = async (commentId, { content }) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: { content }
    });
    return data.comment;
};

/**
 * Soft-deletes a comment (authorized for comment author or parent post author).
 * @param {string} commentId - Comment UUID
 * @returns {Promise<object>} { message: string, comment_id: string }
 */
export const deleteComment = async (commentId) => {
    const csrfToken = await fetchCsrfToken(false);
    const data = await apiClient(`/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    return data;
};
