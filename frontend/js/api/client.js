/**
 * Resilient Fetch API Client
 * Wraps browser fetch with timeout, standard headers, and normalized error responses.
 */
import { API_CONFIG } from './config.js';

export class ApiError extends Error {
    constructor(message, status = 0, code = 'NETWORK_ERROR', details = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export const apiClient = async (endpoint, options = {}) => {
    const url = endpoint.startsWith('http') ? endpoint : `${API_CONFIG.BASE_URL}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || API_CONFIG.TIMEOUT_MS);

    const headers = {
        'Accept': 'application/json',
        'X-Frenzo-Request': '1',
        ...(options.headers || {})
    };

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            signal: controller.signal,
            credentials: 'include' // Transmit cookies for future auth sessions
        });

        clearTimeout(timeoutId);

        let data = null;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        if (!response.ok) {
            const errorMessage = (data && data.error && data.error.message) || response.statusText || 'Request failed';
            const errorCode = (data && data.error && data.error.code) || `HTTP_${response.status}`;
            throw new ApiError(errorMessage, response.status, errorCode, data);
        }

        return data;
    } catch (err) {
        clearTimeout(timeoutId);

        if (err.name === 'AbortError') {
            throw new ApiError('Request timed out. Please check your network connection.', 408, 'TIMEOUT');
        }

        if (err instanceof ApiError) {
            throw err;
        }

        throw new ApiError(
            err.message || 'Unable to connect to Frenzo backend service.',
            0,
            'CONNECTION_FAILED'
        );
    }
};
