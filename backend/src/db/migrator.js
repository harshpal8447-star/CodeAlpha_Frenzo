/**
 * Frenzo Database Migration Runner & Inspector
 * Manages schema evolution and execution history tracking using DATABASE_DIRECT_URL.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const config = require('../config/env');

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

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
 * Creates a dedicated direct client for DDL operations.
 */
const createDirectClient = () => {
    const connectionString = config.database.directUrl || config.database.url;
    return new Client({
        connectionString,
        ssl: getSslConfig(connectionString),
        connectionTimeoutMillis: config.database.connectionTimeoutMillis
    });
};

/**
 * Inspects migration status without mutating schema.
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

    if (!config.database.isDirectConfigured && !config.database.isConfigured) {
        console.log('ℹ️  Target database (DATABASE_DIRECT_URL) is NOT configured yet.');
        console.log('    Placeholders detected in backend/.env. Real connection is PENDING.\n');
        console.log('Local Migration Files Discovered:');
        files.forEach((file) => {
            console.log(`  [PENDING CONFIG] ${file}`);
        });
        console.log('\nTo connect: populate DATABASE_DIRECT_URL in backend/.env with your Supabase credentials.');
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
                console.log(`  ✅ [APPLIED] ${file} (Executed: ${new Date(info.executed_at).toISOString()})`);
            } else {
                console.log(`  ⏳ [PENDING] ${file}`);
            }
        });
        console.log('\n======================================================\n');
    } catch (err) {
        const sanitized = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Connection error';
        console.error(`❌ Migration status check failed: ${sanitized}`);
        console.log('======================================================\n');
    } finally {
        await client.end().catch(() => {});
    }
};

/**
 * Executes all pending migrations in sequential order.
 */
const runMigrations = async () => {
    console.log('\n======================================================');
    console.log('🚀 EXECUTING DATABASE MIGRATIONS');
    console.log('======================================================');

    if (!config.database.isDirectConfigured && !config.database.isConfigured) {
        console.error('❌ Cannot run migrations: DATABASE_DIRECT_URL is not configured in backend/.env.');
        console.error('   Please copy your connection string from the Supabase dashboard.');
        process.exit(1);
    }

    const files = getMigrationFiles();
    if (files.length === 0) {
        console.log('No migration files found to execute.');
        return;
    }

    const client = createDirectClient();
    try {
        await client.connect();
        await ensureMigrationTable(client);
        const executed = await getExecutedMigrations(client);
        const executedSet = new Set(executed.map((m) => m.name));

        const pending = files.filter((f) => !executedSet.has(f));
        if (pending.length === 0) {
            console.log('✨ All migrations are already up to date. Nothing to run.');
            console.log('======================================================\n');
            return;
        }

        console.log(`Found ${pending.length} pending migration(s) to apply:\n`);

        for (const file of pending) {
            const filePath = path.join(MIGRATIONS_DIR, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const checksum = computeChecksum(content);

            console.log(`Applying: ${file}...`);
            try {
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
                console.error('   Transaction rolled back. No schema changes were committed.');
                process.exit(1);
            }
        }

        console.log('\n🎉 All pending migrations applied successfully.');
        console.log('======================================================\n');
    } catch (err) {
        const sanitized = err.message ? err.message.replace(/:[^:@]*@/, ':****@') : 'Connection error';
        console.error(`\n❌ Database connection failed: ${sanitized}`);
        process.exit(1);
    } finally {
        await client.end().catch(() => {});
    }
};

// CLI Command Switchboard
const command = process.argv[2] || 'status';

if (command === 'status') {
    inspectStatus();
} else if (command === 'up') {
    runMigrations();
} else {
    console.log(`Unknown command "${command}". Available commands: status, up`);
    process.exit(1);
}

module.exports = {
    getMigrationFiles,
    inspectStatus,
    runMigrations
};
