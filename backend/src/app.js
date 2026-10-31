/**
 * Express Application Configuration
 * Assembles security middleware, parsers, logging, routes, and error handling.
 */
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config/env');
const corsMiddleware = require('./middleware/corsConfig');
const { globalRateLimiter } = require('./middleware/rateLimiter');
const notFoundHandler = require('./middleware/notFoundHandler');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const postRoutes = require('./routes/postRoutes');
const commentRoutes = require('./routes/commentRoutes');

const app = express();

// Security: Helmet HTTP Headers
app.use(helmet({
    contentSecurityPolicy: false, // Disabled in Phase 1 to allow local frontend file and asset serving
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS Allowlisting
app.use(corsMiddleware);

// Request Logging
if (config.env !== 'test') {
    app.use(morgan(config.env === 'development' ? 'dev' : 'combined'));
}

// Global Rate Limiting
app.use('/api', globalRateLimiter);

// Body Parsers with conservative size limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// API Routes (mounted before static assets to prevent shadowing)
app.use(`/api/${config.apiVersion}`, healthRoutes);
app.use(`/api/${config.apiVersion}/auth`, authRoutes);
app.use(`/api/${config.apiVersion}/users`, userRoutes);
app.use(`/api/${config.apiVersion}/posts`, postRoutes);
app.use(`/api/${config.apiVersion}/comments`, commentRoutes);

// Serve Frontend Static Assets (CSS, JS, media, public HTML)
const frontendPath = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendPath));
app.use(express.static(path.resolve(frontendPath, 'public')));

// Catch-all route to serve frontend/public/index.html for SPA History API routing
app.get('*', (req, res, next) => {
    // If request is for an API endpoint that wasn't found, skip to notFoundHandler
    if (req.originalUrl.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.resolve(frontendPath, 'public/index.html'));
});

// 404 Handler for undefined API routes
app.use(notFoundHandler);

// Centralized Error Handler
app.use(errorHandler);

module.exports = app;
