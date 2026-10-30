/**
 * Centralized API Configuration
 * Determines API base URL dynamically based on current browser host
 */
const getApiBaseUrl = () => {
    // If running on a dedicated dev server (e.g., port 3000, 8080) or file system, connect to Express backend on port 5000
    if (window.location.port !== '5000' && window.location.hostname === 'localhost') {
        return 'http://localhost:5000/api/v1';
    }
    if (window.location.port !== '5000' && window.location.hostname === '127.0.0.1') {
        return 'http://127.0.0.1:5000/api/v1';
    }
    // If served directly by the Express backend
    return `${window.location.origin}/api/v1`;
};

export const API_CONFIG = {
    BASE_URL: getApiBaseUrl(),
    TIMEOUT_MS: 8000,
    VERSION: 'v1'
};
