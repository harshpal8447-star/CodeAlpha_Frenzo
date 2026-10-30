/**
 * Diagnostic health check controller
 * Lightweight status check; does not query database or external services.
 */
const getHealth = (req, res) => {
    return res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Number(process.uptime().toFixed(2)),
        version: '1.0.0'
    });
};

module.exports = {
    getHealth
};
