/**
 * HTTP Server Entry Point
 * Handles network listener and graceful process termination.
 */
const app = require('./app');
const config = require('./config/env');

const server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(`🚀 Frenzo API Server running in ${config.env.toUpperCase()} mode`);
    console.log(`🌐 Server Port:      http://localhost:${config.port}`);
    console.log(`🩺 Health Endpoint:  http://localhost:${config.port}/api/${config.apiVersion}/health`);
    console.log(`🎨 Frontend App:     http://localhost:${config.port}/`);
    console.log(`====================================================`);
});

// Graceful process termination
const handleShutdown = (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });

    // Force shutdown if cleanup hangs
    setTimeout(() => {
        console.error('Forced shutdown due to timeout.');
        process.exit(1);
    }, 5000);
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

module.exports = server;
