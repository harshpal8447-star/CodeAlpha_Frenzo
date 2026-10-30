/**
 * Environment configuration loader and validator
 */
const path = require('path');
const dotenv = require('dotenv');

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isPlaceholder = (val) => {
    if (!val) return true;
    return val.includes('your-project-ref') || val.includes('your-db-password') || val.includes('[PROJECT_REF]') || val.includes('[PASSWORD]');
};

const databaseUrl = process.env.DATABASE_URL || '';
const databaseDirectUrl = process.env.DATABASE_DIRECT_URL || databaseUrl;

const config = {
    env: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    port: parseInt(process.env.PORT, 10) || 5000,
    apiVersion: process.env.API_VERSION || 'v1',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5000,http://127.0.0.1:5000')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean),
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 200
    },
    database: {
        url: databaseUrl,
        directUrl: databaseDirectUrl,
        isConfigured: !isPlaceholder(databaseUrl) && databaseUrl.length > 0,
        isDirectConfigured: !isPlaceholder(databaseDirectUrl) && databaseDirectUrl.length > 0,
        poolMax: parseInt(process.env.DATABASE_POOL_MAX, 10) || 10,
        idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS, 10) || 30000,
        connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 10) || 5000
    },
    security: {
        csrfSecret: process.env.CSRF_SECRET || 'frenzo_dev_csrf_secret_must_be_set_in_production_environment_32b',
        jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'frenzo_dev_jwt_access_secret_replace_in_prod',
        jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'frenzo_dev_jwt_refresh_secret_replace_in_prod',
        cookieSecret: process.env.COOKIE_SECRET || 'frenzo_dev_cookie_signing_secret_replace_in_prod'
    }
};

module.exports = config;
