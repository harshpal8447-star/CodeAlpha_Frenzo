/**
 * Frenzo Phase 2.3 Comprehensive Authentication & Security Test Suite
 * Validates registration, atomic profile creation, login, token family rotation,
 * refresh reuse detection, logout, signed double-submit CSRF, and account enumeration protection.
 * Uses disposable test accounts and cleans up the database completely upon completion.
 */
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const { query, closePool } = require('../src/config/database');

const TEST_DOMAIN = '@frenzo-test.internal';
const TEST_TIMESTAMP = Date.now();
const USER_1 = {
    email: `alice_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `alice_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Alice_123!',
    display_name: 'Alice In Wonderland'
};
const USER_2 = {
    email: `bob_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `bob_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Bob_456!',
    display_name: 'Bob The Builder'
};

let server;
let baseUrl;

// Simple cookie & header helper for testing
class TestClient {
    constructor() {
        this.cookies = {};
    }

    parseCookies(response) {
        // Handle set-cookie headers
        const rawHeaders = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
        if (rawHeaders.length === 0) {
            const single = response.headers.get('set-cookie');
            if (single) rawHeaders.push(single);
        }

        for (const str of rawHeaders) {
            const parts = str.split(';')[0].split('=');
            const name = parts[0].trim();
            const val = parts.slice(1).join('=').trim();
            if (str.includes('Max-Age=0') || str.includes('expires=')) {
                delete this.cookies[name];
            } else {
                this.cookies[name] = val;
            }
        }
    }

    getCookieHeader() {
        return Object.entries(this.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    async request(path, options = {}) {
        const url = `${baseUrl}${path}`;
        const headers = options.headers || {};

        const cookieHeader = this.getCookieHeader();
        if (cookieHeader) {
            headers['cookie'] = cookieHeader;
        }

        if (options.body && typeof options.body === 'object' && !(options.body instanceof String)) {
            headers['content-type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }

        const res = await fetch(url, {
            ...options,
            headers
        });

        this.parseCookies(res);

        let data = null;
        const text = await res.text();
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }

        return {
            status: res.status,
            headers: res.headers,
            body: data
        };
    }
}

// Cleanup helper to ensure zero permanent data
const cleanupDatabase = async () => {
    try {
        await query(`DELETE FROM users WHERE email LIKE '%${TEST_DOMAIN}';`);
    } catch (err) {
        console.error('Warning: Failed to cleanup test users:', err.message);
    }
};

const runTests = async () => {
    console.log('\n======================================================');
    console.log('🧪 FRENZO AUTHENTICATION & SECURITY TEST SUITE (PHASE 2.3)');
    console.log('======================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition, testName, details = '') => {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName} ${details ? '— ' + details : ''}`);
            failed++;
        }
    };

    // Start ephemeral server
    await new Promise((resolve) => {
        server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    try {
        // Ensure starting clean
        await cleanupDatabase();

        // -------------------------------------------------------------
        // TEST 1: Signed Double-Submit CSRF Protection
        // -------------------------------------------------------------
        console.log('1️⃣  Testing CSRF Protection Mechanisms...');
        const client1 = new TestClient();

        // 1.1 Mutation without CSRF token must fail (403)
        const noCsrfRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            body: USER_1
        });
        assert(noCsrfRes.status === 403 && noCsrfRes.body?.error?.code === 'CSRF_VERIFICATION_FAILED',
            'Rejects POST request without CSRF token (403)');

        // 1.2 Mutation with forged CSRF token must fail (403)
        const forgedCsrfRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': 'fake_untrusted_csrf_token_value_32_bytes' },
            body: USER_1
        });
        assert(forgedCsrfRes.status === 403 && forgedCsrfRes.body?.error?.code === 'CSRF_VERIFICATION_FAILED',
            'Rejects POST request with forged CSRF token (403)');

        // 1.3 Fetch valid CSRF token from public GET endpoint
        const csrfRes = await client1.request('/api/v1/auth/csrf');
        assert(csrfRes.status === 200 && csrfRes.body?.csrfToken && client1.cookies['frenzo_csrf_token'],
            'Issues signed CSRF cookie and raw token via GET /csrf');
        const validCsrfToken = csrfRes.body.csrfToken;

        console.log('');

        // -------------------------------------------------------------
        // TEST 2: Registration Validation & Normalization
        // -------------------------------------------------------------
        console.log('2️⃣  Testing Registration Validation & Constraints...');

        // 2.1 Invalid email
        const badEmailRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': validCsrfToken },
            body: { ...USER_1, email: 'not-an-email' }
        });
        assert(badEmailRes.status === 400 && badEmailRes.body?.error?.code === 'INVALID_EMAIL',
            'Rejects invalid email format (400)');

        // 2.2 Invalid username (too short or special characters)
        const badUserRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': validCsrfToken },
            body: { ...USER_1, username: 'a!' }
        });
        assert(badUserRes.status === 400 && badUserRes.body?.error?.code === 'INVALID_USERNAME',
            'Rejects invalid username syntax (400)');

        // 2.3 Password length constraint
        const badPwdRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': validCsrfToken },
            body: { ...USER_1, password: '123' }
        });
        assert(badPwdRes.status === 400 && badPwdRes.body?.error?.code === 'INVALID_PASSWORD',
            'Rejects short password < 8 characters (400)');

        // 2.4 Successful Registration
        const regRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': validCsrfToken },
            body: USER_1
        });
        assert(regRes.status === 201 && regRes.body?.user?.email === USER_1.email.toLowerCase(),
            'Registers user successfully and returns 201 Created');
        assert(Boolean(client1.cookies['frenzo_access_token']) && Boolean(client1.cookies['frenzo_refresh_token']),
            'Sets HttpOnly access and refresh session cookies upon registration');
        assert(!regRes.body?.user?.password_hash,
            'Sanitizes user object: password_hash is strictly excluded');

        console.log('');

        // -------------------------------------------------------------
        // TEST 3: Atomic User and Profile Verification
        // -------------------------------------------------------------
        console.log('3️⃣  Testing Atomic User & Profile Creation In Database...');
        const dbCheck = await query(
            `SELECT u.id, u.email, u.password_hash, p.username, p.display_name, p.followers_count
             FROM users u
             JOIN profiles p ON u.id = p.id
             WHERE LOWER(u.email) = $1;`,
            [USER_1.email.toLowerCase()]
        );
        assert(dbCheck.rows.length === 1 && dbCheck.rows[0].username === USER_1.username.toLowerCase(),
            'Verifies matching users and profiles records created atomically with identical UUID');
        assert(dbCheck.rows[0].password_hash.startsWith('$argon2id$'),
            'Verifies password is encrypted using Argon2id ($argon2id$ prefix)');

        console.log('');

        // -------------------------------------------------------------
        // TEST 4: Duplicate Email & Username Rejection
        // -------------------------------------------------------------
        console.log('4️⃣  Testing Uniqueness Constraints & Duplicate Prevention...');

        // 4.1 Duplicate email
        const dupEmailRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': validCsrfToken },
            body: {
                ...USER_1,
                username: `unique_${Date.now()}`.substring(0, 25)
            }
        });
        assert(dupEmailRes.status === 409 && dupEmailRes.body?.error?.code === 'EMAIL_ALREADY_EXISTS',
            'Prevents duplicate email registration (409 Conflict)');

        // 4.2 Duplicate username (case-insensitive)
        const dupUserRes = await client1.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': validCsrfToken },
            body: {
                ...USER_1,
                email: `unique_${Date.now()}${TEST_DOMAIN}`,
                username: USER_1.username.toUpperCase() // Test case-insensitive collision
            }
        });
        assert(dupUserRes.status === 409 && dupUserRes.body?.error?.code === 'USERNAME_ALREADY_EXISTS',
            'Prevents case-insensitive duplicate username registration (409 Conflict)');

        console.log('');

        // -------------------------------------------------------------
        // TEST 5: Login Verification & Enumeration Defense
        // -------------------------------------------------------------
        console.log('5️⃣  Testing Login Authentication & Enumeration Defense...');
        const client2 = new TestClient();
        const csrf2 = await client2.request('/api/v1/auth/csrf');
        const token2 = csrf2.body.csrfToken;

        // 5.1 Invalid password
        const badLoginPwd = await client2.request('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'x-csrf-token': token2 },
            body: { identifier: USER_1.email, password: 'WrongPassword999!' }
        });
        assert(badLoginPwd.status === 401 && badLoginPwd.body?.error?.code === 'INVALID_CREDENTIALS',
            'Rejects incorrect password with generic error (401)');

        // 5.2 Non-existent user (Account enumeration check)
        const badLoginUser = await client2.request('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'x-csrf-token': token2 },
            body: { identifier: `nonexistent_${Date.now()}${TEST_DOMAIN}`, password: 'AnyPassword123!' }
        });
        assert(badLoginUser.status === 401 && badLoginUser.body?.error?.code === 'INVALID_CREDENTIALS',
            'Rejects non-existent account with identical generic error (401) to prevent user enumeration');

        // 5.3 Successful login using email
        const loginEmailRes = await client2.request('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'x-csrf-token': token2 },
            body: { identifier: USER_1.email, password: USER_1.password }
        });
        assert(loginEmailRes.status === 200 && loginEmailRes.body?.user?.username === USER_1.username.toLowerCase(),
            'Authenticates successfully using email identifier (200 OK)');

        // 5.4 Successful login using username
        const client3 = new TestClient();
        const csrf3 = await client3.request('/api/v1/auth/csrf');
        const loginUserRes = await client3.request('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'x-csrf-token': csrf3.body.csrfToken },
            body: { identifier: USER_1.username, password: USER_1.password }
        });
        assert(loginUserRes.status === 200 && loginUserRes.body?.user?.email === USER_1.email.toLowerCase(),
            'Authenticates successfully using username identifier (200 OK)');

        console.log('');

        // -------------------------------------------------------------
        // TEST 6: Protected Route Access (GET /api/v1/auth/me)
        // -------------------------------------------------------------
        console.log('6️⃣  Testing Protected Identity Access (GET /api/v1/auth/me)...');

        // 6.1 Unauthenticated request
        const unauthClient = new TestClient();
        const unauthRes = await unauthClient.request('/api/v1/auth/me');
        assert(unauthRes.status === 401 && unauthRes.body?.error?.code === 'UNAUTHORIZED',
            'Rejects unauthenticated request without session cookie (401)');

        // 6.2 Authenticated request
        const authRes = await client2.request('/api/v1/auth/me');
        assert(authRes.status === 200 && authRes.body?.user?.email === USER_1.email.toLowerCase(),
            'Returns authenticated profile data using HttpOnly access cookie (200 OK)');

        console.log('');

        // -------------------------------------------------------------
        // TEST 7: Access Token Expiry & Refresh Token Rotation
        // -------------------------------------------------------------
        console.log('7️⃣  Testing Access Token Expiry & Refresh Token Rotation...');

        // 7.1 Test expired access token
        const expiredClient = new TestClient();
        const expiredJwt = jwt.sign(
            { sub: dbCheck.rows[0].id, email: USER_1.email, username: USER_1.username },
            config.security.jwtAccessSecret,
            { expiresIn: '0s' } // Expired immediately
        );
        expiredClient.cookies['frenzo_access_token'] = expiredJwt;
        const expiredRes = await expiredClient.request('/api/v1/auth/me');
        assert(expiredRes.status === 401 && expiredRes.body?.error?.code === 'TOKEN_EXPIRED',
            'Identifies expired access token and returns 401 TOKEN_EXPIRED');

        // 7.2 Perform Refresh Token Rotation
        const initialRefreshToken = client2.cookies['frenzo_refresh_token'];
        const refreshCsrf = await client2.request('/api/v1/auth/csrf');
        const refreshRes = await client2.request('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'x-csrf-token': refreshCsrf.body.csrfToken }
        });
        assert(refreshRes.status === 200, 'Refreshes session successfully (200 OK)');

        const rotatedRefreshToken = client2.cookies['frenzo_refresh_token'];
        assert(rotatedRefreshToken && rotatedRefreshToken !== initialRefreshToken,
            'Rotates refresh token: new token value is generated and set');

        // Verify previous token is marked revoked and new token has same family in DB
        const oldHash = crypto.createHash('sha256').update(initialRefreshToken).digest('hex');
        const newHash = crypto.createHash('sha256').update(rotatedRefreshToken).digest('hex');

        const tokenDbCheck = await query(
            `SELECT token_hash, family_id, is_revoked FROM refresh_tokens WHERE token_hash IN ($1, $2);`,
            [oldHash, newHash]
        );
        const oldRow = tokenDbCheck.rows.find(r => r.token_hash === oldHash);
        const newRow = tokenDbCheck.rows.find(r => r.token_hash === newHash);

        assert(oldRow?.is_revoked === true, 'Database confirms prior refresh token is revoked (is_revoked = true)');
        assert(newRow?.is_revoked === false, 'Database confirms new refresh token is active (is_revoked = false)');
        assert(oldRow?.family_id === newRow?.family_id, 'Both tokens maintain identical family_id across rotation');

        console.log('');

        // -------------------------------------------------------------
        // TEST 8: Refresh Token Reuse Detection (Compromise Scenario)
        // -------------------------------------------------------------
        console.log('8️⃣  Testing Refresh Token Reuse Detection & Family Revocation...');
        const attackerClient = new TestClient();
        attackerClient.cookies['frenzo_refresh_token'] = initialRefreshToken; // Attacker presents the OLD revoked token!
        const attackerCsrf = await attackerClient.request('/api/v1/auth/csrf');

        const reuseRes = await attackerClient.request('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'x-csrf-token': attackerCsrf.body.csrfToken }
        });
        assert(reuseRes.status === 401 && reuseRes.body?.error?.code === 'REFRESH_TOKEN_REUSED',
            'Detects revoked token reuse and triggers security revocation (401 REFRESH_TOKEN_REUSED)');

        // Verify that the ENTIRE token family is now revoked in the database
        const familyCheck = await query(
            `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_revoked = TRUE)::int AS revoked
             FROM refresh_tokens
             WHERE family_id = $1;`,
            [oldRow.family_id]
        );
        assert(familyCheck.rows[0].total > 0 && familyCheck.rows[0].total === familyCheck.rows[0].revoked,
            'Confirms entire token family is revoked in database upon reuse detection');

        // Verify the legitimate client can no longer refresh using the rotated token
        const legitRefreshAttempt = await client2.request('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'x-csrf-token': refreshCsrf.body.csrfToken }
        });
        assert(legitRefreshAttempt.status === 401,
            'Legitimate client session in revoked family is safely terminated');

        console.log('');

        // -------------------------------------------------------------
        // TEST 9: Logout & Session Revocation
        // -------------------------------------------------------------
        console.log('9️⃣  Testing Logout & Session Termination...');
        // Create user 2 to test clean logout
        const user2Client = new TestClient();
        const csrfUser2 = await user2Client.request('/api/v1/auth/csrf');
        await user2Client.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': csrfUser2.body.csrfToken },
            body: USER_2
        });

        const activeToken = user2Client.cookies['frenzo_refresh_token'];
        const activeHash = crypto.createHash('sha256').update(activeToken).digest('hex');

        // Logout
        const logoutRes = await user2Client.request('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'x-csrf-token': csrfUser2.body.csrfToken }
        });
        assert(logoutRes.status === 200 && logoutRes.body?.message === 'Logout successful.',
            'Logs out successfully (200 OK)');
        assert(!user2Client.cookies['frenzo_access_token'] && !user2Client.cookies['frenzo_refresh_token'],
            'Clears access and refresh cookies upon logout');

        // Verify database session is revoked
        const logoutDbCheck = await query(
            `SELECT is_revoked FROM refresh_tokens WHERE token_hash = $1;`,
            [activeHash]
        );
        assert(logoutDbCheck.rows[0]?.is_revoked === true,
            'Database records refresh token as revoked following logout');

        console.log('');

        // -------------------------------------------------------------
        // TEST 10: Existing Health Check Regression Verification
        // -------------------------------------------------------------
        console.log('🔟  Testing Existing Health Endpoint Regression...');
        const healthRes = await client1.request('/api/v1/health');
        assert(healthRes.status === 200 && healthRes.body?.status === 'ok',
            'Confirms GET /api/v1/health continues to return HTTP 200 OK');

        console.log('\n======================================================');
        console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
        console.log('======================================================\n');

        if (failed > 0) {
            process.exitCode = 1;
        }
    } finally {
        // Cleanup all created test data completely
        await cleanupDatabase();
        console.log('🧹 Cleaned up all disposable test accounts from database.');

        // Close server and database pool
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await closePool();
    }
};

if (require.main === module) {
    runTests().catch((err) => {
        console.error('Fatal Test Suite Error:', err);
        process.exit(1);
    });
}

module.exports = { runTests };
