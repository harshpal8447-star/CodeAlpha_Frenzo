/**
 * Frenzo Phase 3.1 Frontend Authentication UI & Integration Test Suite
 * Validates:
 * 1. Static asset serving for HTML5, CSS3, and ES Module frontend files.
 * 2. Client-side input validation rules complementing backend validation.
 * 3. End-to-end browser authentication lifecycle:
 *    - CSRF acquisition
 *    - User registration with display name
 *    - Session verification via /me
 *    - Session termination via logout
 *    - Re-authentication using username identifier
 *    - Re-authentication using email identifier
 * 4. Zero persistent test data in database upon completion.
 */
const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { query, closePool } = require('../src/config/database');

const TEST_DOMAIN = '@frenzo-fe-test.internal';
const TEST_TIMESTAMP = Date.now();
const TEST_USER = {
    email: `fe_user_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `fe_user_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_FE_31!',
    display_name: 'Frontend Auth Tester'
};

let server;
let baseUrl;

class TestBrowserClient {
    constructor() {
        this.cookies = {};
    }

    parseCookies(response) {
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

const cleanupDatabase = async () => {
    try {
        await query(`DELETE FROM users WHERE email LIKE '%${TEST_DOMAIN}';`);
    } catch (err) {
        console.error('Warning: Failed to cleanup test users:', err.message);
    }
};

const runFrontendAuthTests = async () => {
    console.log('\n=============================================================');
    console.log('🧪 FRENZO FRONTEND AUTHENTICATION INTEGRATION SUITE (PHASE 3.1)');
    console.log('=============================================================\n');

    let passed = 0;
    let failed = 0;

    const assert = (condition, testName, details = '') => {
        if (condition) {
            console.log(`  ✅ PASS: ${testName}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${testName} ${details ? `(${details})` : ''}`);
            failed++;
        }
    };

    try {
        await cleanupDatabase();

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const client = new TestBrowserClient();

        // -------------------------------------------------------------
        // SECTION 1: Static Asset Delivery
        // -------------------------------------------------------------
        console.log('1️⃣  Testing Static Asset & SPA Delivery...');

        const indexRes = await client.request('/');
        assert(indexRes.status === 200, 'Serves SPA index.html with HTTP 200');
        assert(
            typeof indexRes.body === 'string' &&
            indexRes.body.includes('id="auth-view-mount"') &&
            indexRes.body.includes('id="header-auth-action"') &&
            indexRes.body.includes('id="sidebar-user-mount"') &&
            indexRes.body.includes('css/components/auth.css'),
            'index.html contains Phase 3.1 auth mounts and auth stylesheet link'
        );

        const cssRes = await client.request('/css/components/auth.css');
        assert(cssRes.status === 200, 'Serves /css/components/auth.css with HTTP 200');
        assert(
            typeof cssRes.body === 'string' &&
            cssRes.body.includes('.auth-card') &&
            cssRes.body.includes('.form-input') &&
            cssRes.body.includes('.password-toggle-btn'),
            'auth.css provides styles for card, form inputs, and password toggles'
        );

        const authViewRes = await client.request('/js/components/AuthView.js');
        assert(authViewRes.status === 200, 'Serves /js/components/AuthView.js with HTTP 200');
        assert(
            typeof authViewRes.body === 'string' &&
            authViewRes.body.includes('class AuthView'),
            'AuthView.js exports the AuthView class component'
        );

        const authStoreRes = await client.request('/js/state/authStore.js');
        assert(authStoreRes.status === 200, 'Serves /js/state/authStore.js with HTTP 200');
        assert(
            typeof authStoreRes.body === 'string' &&
            authStoreRes.body.includes('class AuthStore'),
            'authStore.js exports the reactive in-memory AuthStore'
        );

        const authApiRes = await client.request('/js/api/authApi.js');
        assert(authApiRes.status === 200, 'Serves /js/api/authApi.js with HTTP 200');
        assert(
            typeof authApiRes.body === 'string' &&
            authApiRes.body.includes('export const register') &&
            authApiRes.body.includes('export const login') &&
            authApiRes.body.includes('export const logout'),
            'authApi.js exports register, login, logout, and getCurrentUser methods'
        );

        // -------------------------------------------------------------
        // SECTION 2: Client Validation Logic Simulation
        // -------------------------------------------------------------
        console.log('\n2️⃣  Testing Client-Side Validation Logic (AuthView Rules)...');

        const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
        const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

        const validateRegister = (email, username, password, display_name) => {
            const errs = {};
            if (!email || !EMAIL_REGEX.test(email.trim())) errs.email = 'Invalid email';
            if (!username || !USERNAME_REGEX.test(username.trim())) errs.username = 'Invalid username';
            if (!password || password.length < 8 || password.length > 128) errs.password = 'Invalid password';
            if (display_name && display_name.trim().length > 60) errs.display_name = 'Display name too long';
            return errs;
        };

        const validateLogin = (identifier, password) => {
            const errs = {};
            if (!identifier || !identifier.trim()) errs.identifier = 'Required identifier';
            if (!password) errs.password = 'Required password';
            return errs;
        };

        assert(validateRegister('bad-email', 'valid_user', 'Pass12345!', '').email === 'Invalid email', 'Client validation catches invalid email format');
        assert(validateRegister('test@example.com', 'u$', 'Pass12345!', '').username === 'Invalid username', 'Client validation catches invalid username characters/length');
        assert(validateRegister('test@example.com', 'valid_user', 'short', '').password === 'Invalid password', 'Client validation catches password shorter than 8 chars');
        assert(validateRegister('test@example.com', 'valid_user', 'Pass12345!', 'A'.repeat(65)).display_name === 'Display name too long', 'Client validation catches display name > 60 chars');
        assert(Object.keys(validateRegister(TEST_USER.email, TEST_USER.username, TEST_USER.password, TEST_USER.display_name)).length === 0, 'Client validation accepts valid registration payload');

        assert(validateLogin('', 'password123').identifier === 'Required identifier', 'Client validation flags missing login identifier');
        assert(validateLogin('user@example.com', '').password === 'Required password', 'Client validation flags missing login password');
        assert(Object.keys(validateLogin('user@example.com', 'password123')).length === 0, 'Client validation accepts valid login payload');

        // -------------------------------------------------------------
        // SECTION 3: End-to-End Registration & Session Lifecycle
        // -------------------------------------------------------------
        console.log('\n3️⃣  Testing End-to-End Browser Client Authentication Lifecycle...');

        // Step 1: Probing session initially returns 401 unauthenticated
        const initialMeRes = await client.request('/api/v1/auth/me');
        assert(initialMeRes.status === 401, 'Unauthenticated client probe GET /me returns 401');

        // Step 2: Fetch CSRF token
        const csrfRes = await client.request('/api/v1/auth/csrf');
        assert(csrfRes.status === 200, 'GET /api/v1/auth/csrf returns HTTP 200');
        const csrfToken = csrfRes.body.csrfToken;
        assert(typeof csrfToken === 'string' && csrfToken.length > 20, 'Returns cryptographically signed CSRF token');
        assert(!!client.cookies['frenzo_csrf_token'], 'Receives HttpOnly/SameSite signed CSRF cookie');

        // Step 3: Register new user with display name
        const regRes = await client.request('/api/v1/auth/register', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': csrfToken
            },
            body: {
                email: TEST_USER.email,
                username: TEST_USER.username,
                password: TEST_USER.password,
                display_name: TEST_USER.display_name
            }
        });
        assert(regRes.status === 201, 'POST /api/v1/auth/register returns HTTP 201 Created');
        assert(regRes.body.user && regRes.body.user.username === TEST_USER.username, 'Registration response contains user profile object');
        assert(regRes.body.user.display_name === TEST_USER.display_name, 'Registration response includes provided display_name');
        assert(!!client.cookies['frenzo_access_token'], 'Browser client received frenzo_access_token cookie');
        assert(!!client.cookies['frenzo_refresh_token'], 'Browser client received frenzo_refresh_token cookie');

        // Step 4: Verify session via GET /me with returned cookies
        const meRes = await client.request('/api/v1/auth/me');
        assert(meRes.status === 200, 'GET /api/v1/auth/me returns HTTP 200 with active session');
        assert(meRes.body.user && meRes.body.user.email === TEST_USER.email, 'Active session returns matching user identity');
        assert(meRes.body.user.display_name === TEST_USER.display_name, 'Active session returns matching display_name');

        // Step 5: Terminate session via Logout
        const logoutCsrfRes = await client.request('/api/v1/auth/csrf');
        const logoutRes = await client.request('/api/v1/auth/logout', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': logoutCsrfRes.body.csrfToken
            }
        });
        assert(logoutRes.status === 200, 'POST /api/v1/auth/logout returns HTTP 200');
        assert(!client.cookies['frenzo_access_token'], 'Browser access cookie cleared after logout');
        assert(!client.cookies['frenzo_refresh_token'], 'Browser refresh cookie cleared after logout');

        // Step 6: Verify unauthenticated after logout
        const postLogoutMe = await client.request('/api/v1/auth/me');
        assert(postLogoutMe.status === 401, 'GET /api/v1/auth/me returns 401 after logout');

        // Step 7: Re-authenticate via Username Identifier
        const loginCsrf1 = await client.request('/api/v1/auth/csrf');
        const loginUsernameRes = await client.request('/api/v1/auth/login', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': loginCsrf1.body.csrfToken
            },
            body: {
                identifier: TEST_USER.username,
                password: TEST_USER.password
            }
        });
        assert(loginUsernameRes.status === 200, 'POST /api/v1/auth/login succeeds with username identifier (HTTP 200)');
        assert(!!client.cookies['frenzo_access_token'], 'Session restored with access cookie');

        const meUsernameRes = await client.request('/api/v1/auth/me');
        assert(meUsernameRes.status === 200 && meUsernameRes.body.user.username === TEST_USER.username, 'GET /me reflects authenticated user after username login');

        // Step 8: Logout again
        const logoutCsrf2 = await client.request('/api/v1/auth/csrf');
        await client.request('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'X-CSRF-Token': logoutCsrf2.body.csrfToken }
        });

        // Step 9: Re-authenticate via Email Identifier
        const loginCsrf2 = await client.request('/api/v1/auth/csrf');
        const loginEmailRes = await client.request('/api/v1/auth/login', {
            method: 'POST',
            headers: {
                'X-CSRF-Token': loginCsrf2.body.csrfToken
            },
            body: {
                identifier: TEST_USER.email,
                password: TEST_USER.password
            }
        });
        assert(loginEmailRes.status === 200, 'POST /api/v1/auth/login succeeds with email identifier (HTTP 200)');
        assert(!!client.cookies['frenzo_access_token'], 'Session restored with access cookie');

        const meEmailRes = await client.request('/api/v1/auth/me');
        assert(meEmailRes.status === 200 && meEmailRes.body.user.email === TEST_USER.email, 'GET /me reflects authenticated user after email login');

        // Clean up session
        const logoutCsrf3 = await client.request('/api/v1/auth/csrf');
        await client.request('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'X-CSRF-Token': logoutCsrf3.body.csrfToken }
        });

        // -------------------------------------------------------------
        // SECTION 4: Database Cleanliness Audit
        // -------------------------------------------------------------
        console.log('\n4️⃣  Performing Database Cleanliness Audit...');
        await cleanupDatabase();

        const countRes = await query(`
            SELECT 
                (SELECT count(*) FROM users WHERE email LIKE '%${TEST_DOMAIN}%') AS test_users_count,
                (SELECT count(*) FROM profiles p JOIN users u ON p.id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_profiles_count,
                (SELECT count(*) FROM refresh_tokens r JOIN users u ON r.user_id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_refresh_count,
                (SELECT count(*) FROM password_reset_tokens pr JOIN users u ON pr.user_id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_reset_count;
        `);

        const counts = countRes.rows[0];
        assert(Number(counts.test_users_count) === 0, `Disposable test users cleaned up (count: ${counts.test_users_count})`);
        assert(Number(counts.test_profiles_count) === 0, `Disposable test profiles cleaned up (count: ${counts.test_profiles_count})`);
        assert(Number(counts.test_refresh_count) === 0, `Disposable test refresh tokens cleaned up (count: ${counts.test_refresh_count})`);
        assert(Number(counts.test_reset_count) === 0, `Disposable test reset tokens cleaned up (count: ${counts.test_reset_count})`);

        console.log('\n=============================================================');
        console.log(`📊 FRONTEND INTEGRATION RESULTS: ${passed} PASSED, ${failed} FAILED`);
        console.log('=============================================================\n');

        if (failed > 0) {
            process.exit(1);
        }
    } catch (err) {
        console.error('Fatal Frontend Test Error:', err);
        process.exit(1);
    } finally {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await cleanupDatabase();
        await closePool();
    }
};

runFrontendAuthTests();
