/**
 * PostgreSQL Database Connection Architecture
 * Manages runtime connection pooling using the 'pg' driver.
 */
const { Pool } = require('pg');
const config = require('./env');

let runtimePool = null;

/**
 * Derives secure SSL configuration for the PostgreSQL driver.
 * Cloud-hosted databases (such as Supabase) require SSL over public networks.
 */
const getSslConfig = (connectionString) => {
    // If connecting to local development postgres without SSL
    if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
        return false;
    }

    // For Supabase and remote cloud providers
    return {
        rejectUnauthorized: config.isProduction
    };
};

/**
 * Initializes and returns the runtime database pool.
 * Uses DATABASE_URL (Supavisor Transaction Pooler, Port 6543).
 */
const getPool = () => {
    if (runtimePool) {
        return runtimePool;
    }

    if (!config.database.isConfigured) {
        return null;
    }

    runtimePool = new Pool({
        connectionString: config.database.url,
        ssl: getSslConfig(config.database.url),
        max: config.database.poolMax,
        idleTimeoutMillis: config.database.idleTimeoutMillis,
        connectionTimeoutMillis: config.database.connectionTimeoutMillis
    });

    runtimePool.on('error', (err) => {
        console.error('Unexpected error on idle database client:', err.message);
    });

    return runtimePool;
};

/**
 * Executes a parameterized query on the runtime pool.
 */
const query = async (text, params = []) => {
    const pool = getPool();
    if (!pool) {
        throw new Error('Database is not configured. Please supply DATABASE_URL in backend/.env.');
    }

    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        if (config.env === 'development') {
            // Log queries in dev mode if needed, without exposing parameters containing passwords
            // console.debug('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
        }
        return res;
    } catch (err) {
        // Redact any potential credentials from error message
        const sanitizedMessage = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Database query error';
        const error = new Error(sanitizedMessage);
        error.code = err.code;
        error.detail = err.detail;
        throw error;
    }
};

/**
 * Safely probes database connectivity without logging credentials.
 */
const checkDatabaseConnection = async () => {
    if (!config.database.isConfigured) {
        return {
            configured: false,
            connected: false,
            message: 'Database connection string not configured or contains template placeholders in backend/.env (configuration pending).'
        };
    }

    try {
        const pool = getPool();
        const client = await pool.connect();
        try {
            const result = await client.query('SELECT current_database() AS db_name, version() AS db_version;');
            return {
                configured: true,
                connected: true,
                database: result.rows[0].db_name,
                version: result.rows[0].db_version.split(',')[0],
                message: 'Successfully established connection to PostgreSQL database.'
            };
        } finally {
            client.release();
        }
    } catch (err) {
        const sanitized = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Connection error';
        return {
            configured: true,
            connected: false,
            message: `Connection attempt failed: ${sanitized}`
        };
    }
};

/**
 * Acquires a dedicated PostgreSQL client from the pool for transaction management.
 */
const getClient = async () => {
    const pool = getPool();
    if (!pool) {
        throw new Error('Database is not configured. Please supply DATABASE_URL in backend/.env.');
    }
    return await pool.connect();
};

/**
 * Executes a callback within a managed transaction block.
 * Guarantees COMMIT on success and ROLLBACK on error, releasing the client back to the pool.
 */
const withTransaction = async (callback) => {
    const client = await getClient();
    try {
        await client.query('BEGIN;');
        const result = await callback(client);
        await client.query('COMMIT;');
        return result;
    } catch (err) {
        await client.query('ROLLBACK;').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
};

/**
 * Gracefully shuts down the database connection pool.
 */
const closePool = async () => {
    if (runtimePool) {
        await runtimePool.end();
        runtimePool = null;
    }
};

module.exports = {
    getPool,
    getClient,
    withTransaction,
    query,
    checkDatabaseConnection,
    closePool
};
