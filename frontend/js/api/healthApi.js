/**
 * Health Check API Consumer
 * Queries the canonical GET /api/v1/health endpoint
 */
import { apiClient } from './client.js';

export const checkBackendHealth = async () => {
    const startTime = performance.now();
    const data = await apiClient('/health', { method: 'GET' });
    const latency = Math.round(performance.now() - startTime);

    return {
        ...data,
        latencyMs: latency
    };
};
