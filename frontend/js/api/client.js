/**
 * Resilient Fetch API Client (Phase 3.2 Enhanced)
 * Wraps browser fetch with timeout, standard headers, normalized error responses,
 * and single-flight automatic session refresh on TOKEN_EXPIRED (OBS-01).
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

// Single-flight refresh mutex and session expiration hook
let refreshPromise = null;
let sessionExpiredHandler = null;

/**
 * Registers an observer callback invoked when session refresh fails.
 * @param {Function} handler
 */
export const setSessionExpiredHandler = (handler) => {
    sessionExpiredHandler = handler;
};

/**
 * Executes a single session renewal against POST /api/v1/auth/refresh.
 * Shares in-flight promise across all concurrent 401 TOKEN_EXPIRED requests.
 */
const executeSessionRefresh = async () => {
    try {
        // 1. Obtain CSRF token required for state-changing refresh mutation
        const csrfRes = await fetch(`${API_CONFIG.BASE_URL}/auth/csrf`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Frenzo-Request': '1'
            },
            credentials: 'include'
        });
        const csrfData = await csrfRes.json().catch(() => ({}));
        const csrfToken = csrfData.csrfToken;

        // 2. Perform refresh using HttpOnly cookie and CSRF header
        const res = await fetch(`${API_CONFIG.BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Frenzo-Request': '1',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
            },
            credentials: 'include'
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const msg = (errData && errData.error && errData.error.message) || 'Session renewal failed';
            const code = (errData && errData.error && errData.error.code) || 'REFRESH_FAILED';
            throw new ApiError(msg, res.status, code, errData);
        }

        const data = await res.json();
        return data;
    } catch (err) {
        if (sessionExpiredHandler) {
            try {
                sessionExpiredHandler();
            } catch {
                // Ignore observer errors
            }
        }
        throw err;
    } finally {
        refreshPromise = null;
    }
};

/**
 * Primary API Client Wrapper
 */
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
            credentials: 'include' // Always transmit HttpOnly session cookies
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

            // Automatic Session Renewal Interceptor (OBS-01)
            // Triggered ONLY on 401 TOKEN_EXPIRED, never recursively, never for auth endpoints
            const isAuthEndpoint =
                endpoint.includes('/auth/refresh') ||
                endpoint.includes('/auth/login') ||
                endpoint.includes('/auth/register');

            if (response.status === 401 && errorCode === 'TOKEN_EXPIRED' && !options._isRetry && !isAuthEndpoint) {
                if (!refreshPromise) {
                    refreshPromise = executeSessionRefresh();
                }

                try {
                    await refreshPromise;
                    // Retry original request exactly once
                    return await apiClient(endpoint, {
                        ...options,
                        _isRetry: true
                    });
                } catch {
                    // If refresh failed, throw original ApiError
                    throw new ApiError(errorMessage, response.status, errorCode, data);
                }
            }

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
