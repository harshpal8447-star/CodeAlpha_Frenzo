/**
 * Health routes registration
 * Defines the canonical GET /api/v1/health endpoint
 */
const express = require('express');
const { getHealth } = require('../controllers/healthController');

const router = express.Router();

// Canonical health check
router.get('/health', getHealth);

module.exports = router;
