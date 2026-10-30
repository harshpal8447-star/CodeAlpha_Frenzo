/**
 * Frenzo Database Migration Runner & Inspector
 * Manages schema evolution, transactional rollbacks, checksum verification, and advisory locking.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const config = require('../config/env');

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
// Constant 64-bit advisory lock key dedicated to Frenzo schema migrations
const MIGRATION_ADVISORY_LOCK_ID = 84472026;

/**
 * Derives secure SSL configuration for direct/session migrations connection.
 */
const getSslConfig = (connectionString) => {
    if (!connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
        return false;
    }
    return {
        rejectUnauthorized: config.isProduction
    };
};

/**
 * Computes SHA-256 checksum of migration file content for integrity auditing.
 */
const computeChecksum = (content) => {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
};

/**
 * Discovers and sorts all SQL migration files in the migrations directory.
 */
const getMigrationFiles = () => {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        return [];
    }
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.endsWith('.sql'))
        .sort(); // Lexicographical ordering ensures 001_..., 002_... execute sequentially
};

/**
 * Ensures the migration tracking history table exists in the target database.
 */
const ensureMigrationTable = async (client) => {
    const ddl = `
        CREATE TABLE IF NOT EXISTS _frenzo_migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            checksum VARCHAR(64) NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `;
    await client.query(ddl);
};

/**
 * Retrieves list of already executed migrations from the tracking table.
 */
const getExecutedMigrations = async (client) => {
    const res = await client.query('SELECT name, checksum, executed_at FROM _frenzo_migrations ORDER BY id ASC;');
    return res.rows;
};

/**
 * Creates a dedicated direct client for DDL operations using DATABASE_DIRECT_URL.
 * Strictly uses DATABASE_DIRECT_URL and fails fast if unconfigured. Never falls back to DATABASE_URL.
 */
const createDirectClient = () => {
    if (!config.database.isDirectConfigured) {
        throw new Error(
            'DATABASE_DIRECT_URL is missing, unconfigured, or contains template placeholders in backend/.env. ' +
            'DDL migrations and session advisory locks require a direct connection or session pooler (Port 5432). ' +
            'Falling back to the transaction pooler (DATABASE_URL / Port 6543) is strictly prohibited.'
        );
    }
    const connectionString = config.database.directUrl;
    return new Client({
        connectionString,
        ssl: getSslConfig(connectionString),
        connectionTimeoutMillis: config.database.connectionTimeoutMillis
    });
};

/**
 * Inspects migration status without mutating schema or executing DDL.
 */
const inspectStatus = async () => {
    console.log('\n======================================================');
    console.log('📊 FRENZO DATABASE MIGRATION STATUS');
    console.log('======================================================');

    const files = getMigrationFiles();
    if (files.length === 0) {
        console.log('No migration files found in db/migrations.');
        return;
    }

    if (!config.database.isDirectConfigured) {
        console.log('ℹ️  Target database (DATABASE_DIRECT_URL) is NOT configured yet.');
        console.log('    Placeholders detected in backend/.env. Real direct connection (Port 5432) is PENDING.\n');
        console.log('Local Migration Files Discovered:');
        files.forEach((file) => {
            console.log(`  [PENDING CONFIG] ${file}`);
        });
        console.log('\nTo connect: populate DATABASE_DIRECT_URL in backend/.env with your direct Supabase connection string (Port 5432).');
        console.log('Note: DATABASE_DIRECT_URL is strictly isolated from DATABASE_URL to protect transaction pooler stability.');
        console.log('======================================================\n');
        return;
    }

    const client = createDirectClient();
    try {
        await client.connect();
        await ensureMigrationTable(client);
        const executed = await getExecutedMigrations(client);
        const executedMap = new Map(executed.map((m) => [m.name, m]));

        console.log(`Found ${files.length} migration file(s) on disk:\n`);
        files.forEach((file) => {
            if (executedMap.has(file)) {
                const info = executedMap.get(file);
                const filePath = path.join(MIGRATIONS_DIR, file);
                const currentChecksum = computeChecksum(fs.readFileSync(filePath, 'utf8'));
                const isTampered = currentChecksum !== info.checksum;

                if (isTampered) {
                    console.log(`  ⚠️  [MODIFIED ON DISK] ${file} (Checksum mismatch!)`);
                } else {
                    console.log(`  ✅ [APPLIED] ${file} (Executed: ${new Date(info.executed_at).toISOString()})`);
                }
            } else {
                console.log(`  ⏳ [PENDING] ${file}`);
            }
        });
        console.log('\n======================================================\n');
    } catch (err) {
        const sanitized = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Connection error';
        console.error(`❌ Migration status check failed: ${sanitized}`);
        console.log('======================================================\n');
        process.exitCode = 1;
    } finally {
        await client.end().catch(() => {});
    }
};

/**
 * Executes all pending migrations in sequential order with advisory locking and checksum validation.
 */
const runMigrations = async () => {
    console.log('\n======================================================');
    console.log('🚀 EXECUTING DATABASE MIGRATIONS');
    console.log('======================================================');

    if (!config.database.isDirectConfigured) {
        console.error('❌ Cannot run migrations: DATABASE_DIRECT_URL is missing, unconfigured, or contains template placeholders in backend/.env.');
        console.error('   Migrations require a dedicated direct connection or session pooler (Port 5432) to support DDL operations and session-level advisory locks.');
        console.error('   The migration runner strictly prohibits falling back to the transaction pooler (DATABASE_URL / Port 6543).');
        process.exitCode = 1;
        return;
    }

    const files = getMigrationFiles();
    if (files.length === 0) {
        console.log('No migration files found to execute.');
        return;
    }

    const client = createDirectClient();
    let lockAcquired = false;

    try {
        await client.connect();

        // 1. Acquire PostgreSQL session-level advisory lock to prevent concurrent runners
        await client.query('SELECT pg_advisory_lock($1);', [MIGRATION_ADVISORY_LOCK_ID]);
        lockAcquired = true;

        await ensureMigrationTable(client);
        const executed = await getExecutedMigrations(client);
        const executedMap = new Map(executed.map((m) => [m.name, m]));

        // 2. Audit existing applied migrations against local files for integrity tampering
        for (const [name, info] of executedMap.entries()) {
            const filePath = path.join(MIGRATIONS_DIR, name);
            if (fs.existsSync(filePath)) {
                const onDiskChecksum = computeChecksum(fs.readFileSync(filePath, 'utf8'));
                if (onDiskChecksum !== info.checksum) {
                    throw new Error(
                        `Integrity Error: Previously applied migration "${name}" was modified on disk! ` +
                        `Recorded checksum: ${info.checksum}, Current checksum: ${onDiskChecksum}. Aborting.`
                    );
                }
            }
        }

        const pending = files.filter((f) => !executedMap.has(f));
        if (pending.length === 0) {
            console.log('✨ All migrations are already up to date. Nothing to run.');
            console.log('======================================================\n');
            return;
        }

        console.log(`Found ${pending.length} pending migration(s) to apply:\n`);

        // 3. Apply each pending migration in its own isolated transaction
        for (const file of pending) {
            const filePath = path.join(MIGRATIONS_DIR, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const checksum = computeChecksum(content);

            console.log(`Applying: ${file}...`);
            try {
                // The runner strictly owns transaction boundaries
                await client.query('BEGIN;');
                await client.query(content);
                await client.query(
                    'INSERT INTO _frenzo_migrations (name, checksum) VALUES ($1, $2);',
                    [file, checksum]
                );
                await client.query('COMMIT;');
                console.log(`  -> Applied successfully.`);
            } catch (err) {
                await client.query('ROLLBACK;').catch(() => {});
                const sanitized = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Migration error';
                console.error(`\n❌ Failed to apply migration "${file}": ${sanitized}`);
                console.error('   Transaction rolled back cleanly. No schema changes were committed.');
                throw err;
            }
        }

        console.log('\n🎉 All pending migrations applied successfully.');
        console.log('======================================================\n');
    } catch (err) {
        const sanitized = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Connection error';
        console.error(`\n❌ Migration execution failed: ${sanitized}`);
        process.exitCode = 1;
    } finally {
        if (lockAcquired) {
            try {
                await client.query('SELECT pg_advisory_unlock($1);', [MIGRATION_ADVISORY_LOCK_ID]);
            } catch (unlockErr) {
                console.error('Warning: Failed to release advisory lock explicitly:', unlockErr.message);
            }
        }
        await client.end().catch(() => {});
    }
};

// CLI Command Switchboard
const command = process.argv[2] || 'status';

if (require.main === module) {
    if (command === 'status') {
        inspectStatus();
    } else if (command === 'up') {
        runMigrations();
    } else {
        console.log(`Unknown command "${command}". Available commands: status, up`);
        process.exit(1);
    }
}

module.exports = {
    getMigrationFiles,
    inspectStatus,
    runMigrations
};
