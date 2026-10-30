/**
 * Read-Only Database Connectivity & Session Advisory Lock Verifier
 * Tests both DATABASE_URL (runtime pooler) and DATABASE_DIRECT_URL (direct/session).
 * STRICTLY READ-ONLY: Never executes DDL, never creates tables, and never prints credentials.
 */
const { Pool, Client } = require('pg');
const config = require('../config/env');

const sanitize = (text) => {
    if (!text) return '';
    return text.replace(/:[^:@]*@/, ':****@');
};

const getSslConfig = (connectionString) => {
    if (!connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
        return false;
    }
    return {
        rejectUnauthorized: config.isProduction
    };
};

const verify = async () => {
    console.log('\n======================================================');
    console.log('🔍 FRENZO DATABASE CONNECTIVITY VERIFICATION');
    console.log('======================================================\n');

    const results = {
        runtime: { configured: false, success: false, info: null, error: null },
        direct: { configured: false, success: false, info: null, error: null, advisoryLockVerified: false }
    };

    // -----------------------------------------------------------------
    // 1. Probe Runtime Connection (DATABASE_URL — Port 6543)
    // -----------------------------------------------------------------
    console.log('1️⃣  Checking Runtime Connection (DATABASE_URL)...');
    if (!config.database.isConfigured) {
        console.log('   ⏳ DATABASE_URL is not configured or contains placeholders in backend/.env.');
    } else {
        results.runtime.configured = true;
        let pool = null;
        try {
            pool = new Pool({
                connectionString: config.database.url,
                ssl: getSslConfig(config.database.url),
                connectionTimeoutMillis: config.database.connectionTimeoutMillis
            });
            const client = await pool.connect();
            try {
                const res = await client.query(`
                    SELECT 
                        current_database() AS db_name,
                        current_user AS db_user,
                        version() AS db_version,
                        inet_server_port() AS server_port;
                `);
                const row = res.rows[0];
                results.runtime.success = true;
                results.runtime.info = {
                    database: row.db_name,
                    version: row.db_version ? row.db_version.split(' on ')[0] : 'Unknown',
                    serverPort: row.server_port
                };
                console.log('   ✅ Runtime connection established successfully.');
                console.log(`      Database: ${results.runtime.info.database}`);
                console.log(`      Version:  ${results.runtime.info.version}`);
                console.log(`      Port:     ${results.runtime.info.serverPort}`);
            } finally {
                client.release();
            }
        } catch (err) {
            results.runtime.error = sanitize(err.message);
            console.error(`   ❌ Runtime connection failed: ${results.runtime.error}`);
        } finally {
            if (pool) await pool.end().catch(() => {});
        }
    }

    console.log('');

    // -----------------------------------------------------------------
    // 2. Probe Migration / Advisory Lock Connection (DATABASE_DIRECT_URL — Port 5432)
    // -----------------------------------------------------------------
    console.log('2️⃣  Checking Migration Connection (DATABASE_DIRECT_URL)...');
    if (!config.database.isDirectConfigured) {
        console.log('   ⏳ DATABASE_DIRECT_URL is not configured or contains placeholders in backend/.env.');
    } else {
        results.direct.configured = true;
        const client = new Client({
            connectionString: config.database.directUrl,
            ssl: getSslConfig(config.database.directUrl),
            connectionTimeoutMillis: config.database.connectionTimeoutMillis
        });

        try {
            await client.connect();
            const res = await client.query(`
                SELECT 
                    current_database() AS db_name,
                    current_user AS db_user,
                    version() AS db_version,
                    inet_server_port() AS server_port;
            `);
            const row = res.rows[0];

            // Test session-level advisory lock
            const lockCheck = await client.query('SELECT pg_try_advisory_lock(84472026) AS acquired;');
            const acquired = lockCheck.rows[0]?.acquired === true;
            if (acquired) {
                await client.query('SELECT pg_advisory_unlock(84472026);');
            }

            results.direct.success = true;
            results.direct.advisoryLockVerified = acquired;
            results.direct.info = {
                database: row.db_name,
                version: row.db_version ? row.db_version.split(' on ')[0] : 'Unknown',
                serverPort: row.server_port
            };

            console.log('   ✅ Migration direct/session connection established successfully.');
            console.log(`      Database:      ${results.direct.info.database}`);
            console.log(`      Version:       ${results.direct.info.version}`);
            console.log(`      Port:          ${results.direct.info.serverPort}`);
            console.log(`      Advisory Lock: ${acquired ? 'Supported & Verified' : 'Failed to acquire'}`);
        } catch (err) {
            results.direct.error = sanitize(err.message);
            console.error(`   ❌ Migration direct connection failed: ${results.direct.error}`);
        } finally {
            await client.end().catch(() => {});
        }
    }

    console.log('\n======================================================');
    if (results.runtime.success && results.direct.success && results.direct.advisoryLockVerified) {
        console.log('🎉 VERIFICATION RESULT: All database connections verified successfully.');
    } else if (!results.runtime.configured && !results.direct.configured) {
        console.log('ℹ️  VERIFICATION RESULT: Pending credentials in backend/.env.');
    } else {
        console.log('⚠️  VERIFICATION RESULT: Partial or incomplete connectivity.');
    }
    console.log('======================================================\n');

    return results;
};

if (require.main === module) {
    verify();
}

module.exports = { verify };
