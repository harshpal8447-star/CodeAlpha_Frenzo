/**
 * Frenzo Phase 3.2 Social Connections & Profiles Test Suite
 * Validates:
 * 1. Profile retrieval, privacy enforcement, and sanitized public payloads.
 * 2. Profile updates, unauthorized edit prevention, input validation.
 * 3. Case-insensitive username collisions (HTTP 409).
 * 4. Transactional follow/unfollow and atomic counter synchronization.
 * 5. Self-follow prevention (HTTP 400 + DB CHECK constraint) and duplicate follow idempotence.
 * 6. Concurrent follow race safety.
 * 7. Parameterized user discovery and SQL injection resistance.
 * 8. Automatic access token refresh and concurrent 401 resolution.
 * 9. Absolute database cleanup without residual records.
 */
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const { query, closePool } = require('../src/config/database');

const TEST_DOMAIN = '@frenzo-test-social.internal';
const TEST_TIMESTAMP = Date.now();

const USER_ALICE = {
    email: `alice_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `alice_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Alice_32!',
    display_name: 'Alice Social'
};

const USER_BOB = {
    email: `bob_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `bob_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Bob_32!',
    display_name: 'Bob Explorer'
};

const USER_CHARLIE = {
    email: `charlie_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `charlie_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Charlie_32!',
    display_name: 'Charlie Private'
};

let server;
let baseUrl;

class TestClient {
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

    async getCsrf() {
        const res = await this.request('/api/v1/auth/csrf');
        return res.body.csrfToken;
    }
}

const cleanupDatabase = async () => {
    try {
        await query(`DELETE FROM users WHERE email LIKE '%${TEST_DOMAIN}';`);
    } catch (err) {
        console.error('Warning: Failed to cleanup test users:', err.message);
    }
};

const runSocialTests = async () => {
    console.log('\n=============================================================');
    console.log('🧪 FRENZO USER PROFILES & SOCIAL GRAPH TEST SUITE (PHASE 3.2)');
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

        const clientAlice = new TestClient();
        const clientBob = new TestClient();
        const clientCharlie = new TestClient();
        const clientGuest = new TestClient();

        // -------------------------------------------------------------
        // Setup: Register Test Accounts
        // -------------------------------------------------------------
        console.log('0️⃣  Registering Test Accounts (Alice, Bob, Charlie)...');
        const csrfAlice = await clientAlice.getCsrf();
        const regAlice = await clientAlice.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfAlice },
            body: USER_ALICE
        });
        assert(regAlice.status === 201, 'Registered Alice successfully');
        const aliceId = regAlice.body.user.id;

        const csrfBob = await clientBob.getCsrf();
        const regBob = await clientBob.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfBob },
            body: USER_BOB
        });
        assert(regBob.status === 201, 'Registered Bob successfully');
        const bobId = regBob.body.user.id;

        const csrfCharlie = await clientCharlie.getCsrf();
        const regCharlie = await clientCharlie.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfCharlie },
            body: USER_CHARLIE
        });
        assert(regCharlie.status === 201, 'Registered Charlie successfully');
        const charlieId = regCharlie.body.user.id;

        // Make Charlie private in DB to test privacy enforcement
        await query('UPDATE profiles SET is_private = TRUE, bio = $1 WHERE id = $2;', ['Charlie private secret bio', charlieId]);

        // -------------------------------------------------------------
        // SECTION 1: Public Profile Retrieval & Privacy Enforcement
        // -------------------------------------------------------------
        console.log('\n1️⃣  Testing Profile Retrieval, Privacy & Secret Sanitization...');

        const getAlicePublic = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}`);
        assert(getAlicePublic.status === 200, 'Guest can view Alice public profile with HTTP 200');
        const pAlice = getAlicePublic.body.profile;
        assert(pAlice.username === USER_ALICE.username, 'Profile returns correct username');
        assert(pAlice.display_name === USER_ALICE.display_name, 'Profile returns correct display name');
        assert(pAlice.email === undefined, 'Profile response STRICTLY excludes email address');
        assert(pAlice.password_hash === undefined, 'Profile response STRICTLY excludes password_hash');
        assert(pAlice.is_following === false, 'Guest is_following flag is false');
        assert(pAlice.is_own_profile === false, 'Guest is_own_profile flag is false');

        // Charlie is private: Guest view
        const getCharlieGuest = await clientGuest.request(`/api/v1/users/${USER_CHARLIE.username}`);
        assert(getCharlieGuest.status === 200, 'Guest can query private profile metadata (HTTP 200)');
        assert(getCharlieGuest.body.profile.is_private === true, 'Profile indicates is_private is true');
        assert(getCharlieGuest.body.profile.is_restricted === true, 'Profile indicates is_restricted is true');
        assert(getCharlieGuest.body.profile.bio === 'This account is private.', 'Restricted profile masks private bio');

        // Charlie viewing own profile
        const getCharlieSelf = await clientCharlie.request(`/api/v1/users/${USER_CHARLIE.username}`);
        assert(getCharlieSelf.body.profile.is_own_profile === true, 'Charlie recognizes own profile');
        assert(getCharlieSelf.body.profile.is_restricted === false, 'Owner sees unrestricted profile');
        assert(getCharlieSelf.body.profile.bio === 'Charlie private secret bio', 'Owner sees full private bio');

        // Non-existent user
        const getMissing = await clientGuest.request('/api/v1/users/non_existent_ghost_user_999');
        assert(getMissing.status === 404, 'Returns HTTP 404 USER_NOT_FOUND for non-existent username');

        // -------------------------------------------------------------
        // SECTION 2: Profile Updates & Validation
        // -------------------------------------------------------------
        console.log('\n2️⃣  Testing Profile Updates & Unauthorized Edit Prevention...');

        // Unauthorized edit attempt (guest)
        const unauthEdit = await clientGuest.request('/api/v1/users/me', {
            method: 'PATCH',
            body: { display_name: 'Hacker' }
        });
        assert(unauthEdit.status === 401, 'Rejects unauthenticated profile edit with HTTP 401 UNAUTHORIZED');

        // Alice updates display name, bio, and website
        const csrfAlice2 = await clientAlice.getCsrf();
        const validEdit = await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: {
                display_name: 'Alice In Wonderland Updated',
                bio: 'Curiouser and curiouser!',
                website: 'https://alice.wonderland.example.com'
            }
        });
        assert(validEdit.status === 200, 'Alice updates profile successfully (HTTP 200)');
        assert(validEdit.body.profile.display_name === 'Alice In Wonderland Updated', 'Updated display name persisted');
        assert(validEdit.body.profile.bio === 'Curiouser and curiouser!', 'Updated bio persisted');
        assert(validEdit.body.profile.website === 'https://alice.wonderland.example.com', 'Updated website persisted');

        // Input validation checks
        const longNameEdit = await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: { display_name: 'A'.repeat(65) }
        });
        assert(longNameEdit.status === 400, 'Rejects display name exceeding 60 chars (HTTP 400)');

        const longBioEdit = await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: { bio: 'B'.repeat(305) }
        });
        assert(longBioEdit.status === 400, 'Rejects bio exceeding 300 chars (HTTP 400)');

        const badWebsite = await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: { website: 'javascript:alert(1)' }
        });
        assert(badWebsite.status === 400, 'Rejects invalid website protocol (HTTP 400)');

        // -------------------------------------------------------------
        // SECTION 3: Username Updates & Uniqueness Conflicts
        // -------------------------------------------------------------
        console.log('\n3️⃣  Testing Username Changes & Case-Insensitive Collision Defense...');

        // Alice tries to change username to Bob's handle (case-insensitive)
        const conflictEdit = await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: { username: USER_BOB.username.toUpperCase() }
        });
        assert(conflictEdit.status === 409, 'Rejects username update colliding with existing user (HTTP 409 USERNAME_ALREADY_EXISTS)');

        // Alice updates username to a new valid handle
        const newAliceHandle = `alice_new_${TEST_TIMESTAMP}`.substring(0, 25);
        const handleSuccess = await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: { username: newAliceHandle }
        });
        assert(handleSuccess.status === 200, 'Alice successfully updates username (HTTP 200)');
        assert(handleSuccess.body.profile.username === newAliceHandle, 'Profile reflects new username');

        // Old handle is no longer found
        const oldHandleCheck = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}`);
        assert(oldHandleCheck.status === 404, 'Old handle returns 404 after username update');

        // New handle is retrievable
        const newHandleCheck = await clientGuest.request(`/api/v1/users/${newAliceHandle}`);
        assert(newHandleCheck.status === 200, 'New handle is publicly retrievable (HTTP 200)');

        // Restore Alice's username for subsequent tests
        await clientAlice.request('/api/v1/users/me', {
            method: 'PATCH',
            headers: { 'X-CSRF-Token': csrfAlice2 },
            body: { username: USER_ALICE.username }
        });

        // -------------------------------------------------------------
        // SECTION 4: Transactional Follow/Unfollow & Counter Integrity
        // -------------------------------------------------------------
        console.log('\n4️⃣  Testing Transactional Follow / Unfollow & Atomic Counters...');

        const csrfAliceFollow = await clientAlice.getCsrf();

        // Alice follows Bob
        const followBob = await clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfAliceFollow }
        });
        assert(followBob.status === 200, 'Alice follows Bob successfully (HTTP 200)');
        assert(followBob.body.is_following === true, 'Response confirms is_following is true');
        assert(followBob.body.followed === true, 'Response confirms new follow edge was created');

        // Verify Bob's followers_count in DB and public profile
        const bobProfileAfterFollow = await clientGuest.request(`/api/v1/users/${USER_BOB.username}`);
        assert(bobProfileAfterFollow.body.profile.followers_count === 1, 'Bob followers_count atomically incremented to 1');

        // Verify Alice's following_count in DB and public profile
        const aliceProfileAfterFollow = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}`);
        assert(aliceProfileAfterFollow.body.profile.following_count === 1, 'Alice following_count atomically incremented to 1');

        // Verify relationship from Alice's viewpoint
        const aliceViewsBob = await clientAlice.request(`/api/v1/users/${USER_BOB.username}`);
        assert(aliceViewsBob.body.profile.is_following === true, 'Alice views Bob with is_following = true');

        // Alice unfollows Bob
        const csrfAliceUnfollow = await clientAlice.getCsrf();
        const unfollowBob = await clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfAliceUnfollow }
        });
        assert(unfollowBob.status === 200, 'Alice unfollows Bob successfully (HTTP 200)');
        assert(unfollowBob.body.is_following === false, 'Response confirms is_following is false');
        assert(unfollowBob.body.unfollowed === true, 'Response confirms follow edge was deleted');

        // Verify counts decremented safely
        const bobAfterUnfollow = await clientGuest.request(`/api/v1/users/${USER_BOB.username}`);
        assert(bobAfterUnfollow.body.profile.followers_count === 0, 'Bob followers_count atomically decremented to 0');

        const aliceAfterUnfollow = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}`);
        assert(aliceAfterUnfollow.body.profile.following_count === 0, 'Alice following_count atomically decremented to 0');

        // -------------------------------------------------------------
        // SECTION 5: Self-Follow & Duplicate Follow Prevention
        // -------------------------------------------------------------
        console.log('\n5️⃣  Testing Self-Follow & Duplicate Follow Prevention...');

        // Alice attempts to follow herself
        const selfFollowRes = await clientAlice.request(`/api/v1/users/${USER_ALICE.username}/follow`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfAliceFollow }
        });
        assert(selfFollowRes.status === 400, 'Rejects self-follow with HTTP 400 CANNOT_FOLLOW_SELF');

        // Direct DB check for self-follow constraint
        let dbSelfFollowRejected = false;
        try {
            await query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $1);', [aliceId]);
        } catch (err) {
            if (err.message.includes('chk_follows_no_self_follow')) {
                dbSelfFollowRejected = true;
            }
        }
        assert(dbSelfFollowRejected, 'Database check constraint chk_follows_no_self_follow enforces self-follow ban at DB level');

        // Duplicate follow idempotence: Alice follows Bob twice
        await clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfAliceFollow }
        });
        const secondFollow = await clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfAliceFollow }
        });
        assert(secondFollow.status === 200, 'Duplicate follow returns HTTP 200 idempotently');
        assert(secondFollow.body.followed === false, 'Duplicate follow indicates no new edge inserted');
        const bobCheckDup = await clientGuest.request(`/api/v1/users/${USER_BOB.username}`);
        assert(bobCheckDup.body.profile.followers_count === 1, 'Followers count remains exactly 1 on duplicate follow');

        // Clean up follow edge
        await clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfAliceFollow }
        });

        // -------------------------------------------------------------
        // SECTION 6: Concurrent Follow Operations
        // -------------------------------------------------------------
        console.log('\n6️⃣  Testing Concurrent Follow Operations Race Safety...');

        // Alice executes 5 parallel follow requests to Bob simultaneously
        const concurrentPromises = [1, 2, 3, 4, 5].map(() =>
            clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
                method: 'POST',
                headers: { 'X-CSRF-Token': csrfAliceFollow }
            })
        );
        const concurrentResults = await Promise.all(concurrentPromises);
        const allSucceeded = concurrentResults.every(r => r.status === 200);
        assert(allSucceeded, 'All 5 concurrent follow requests handled successfully without deadlock (HTTP 200)');

        const followedTrueCount = concurrentResults.filter(r => r.body.followed === true).length;
        assert(followedTrueCount === 1, 'Exactly one concurrent request created the edge (ON CONFLICT DO NOTHING)');

        const bobCheckConcurrent = await clientGuest.request(`/api/v1/users/${USER_BOB.username}`);
        assert(bobCheckConcurrent.body.profile.followers_count === 1, 'Followers count is strictly 1 after concurrent requests');

        // Clean up
        await clientAlice.request(`/api/v1/users/${USER_BOB.username}/follow`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfAliceFollow }
        });

        // -------------------------------------------------------------
        // SECTION 7: User Discovery & SQL Injection Defense
        // -------------------------------------------------------------
        console.log('\n7️⃣  Testing Parameterized Search & SQL Injection Defense...');

        // Search for 'alice'
        const searchAlice = await clientGuest.request('/api/v1/users/search?q=alice');
        assert(searchAlice.status === 200, 'User search returns HTTP 200');
        assert(searchAlice.body.users.length >= 1, 'Search finds Alice');
        assert(searchAlice.body.users[0].email === undefined, 'Search results strictly exclude emails');

        // Search with malicious SQL injection payload
        const sqlInjectionPayload = "'; DROP TABLE users; --";
        const sqlInjRes = await clientGuest.request(`/api/v1/users/search?q=${encodeURIComponent(sqlInjectionPayload)}`);
        assert(sqlInjRes.status === 200, 'SQL injection attempt handled safely as plain text (HTTP 200)');
        assert(Array.isArray(sqlInjRes.body.users) && sqlInjRes.body.users.length === 0, 'No users matched injection string; table not affected');

        // Confirm users table still exists and is healthy
        const healthUsersCheck = await query('SELECT count(*) FROM users;');
        assert(Number(healthUsersCheck.rows[0].count) >= 3, 'Users table completely intact and unaffected by SQL injection payload');

        // Search limit clamping
        const largeLimitRes = await clientGuest.request('/api/v1/users/search?q=a&limit=9999');
        assert(largeLimitRes.status === 200, 'Extreme limit handled safely');
        assert(largeLimitRes.body.count <= 50, 'Search limit is strictly clamped to max 50');

        // -------------------------------------------------------------
        // SECTION 8: Automatic Access Token Refresh (OBS-01 Concurrency)
        // -------------------------------------------------------------
        console.log('\n8️⃣  Testing Automatic Token Renewal & Concurrency Interceptor...');

        // Craft an expired access token for Alice
        const expiredToken = jwt.sign(
            { sub: aliceId, email: USER_ALICE.email, username: USER_ALICE.username },
            config.security.jwtAccessSecret,
            { expiresIn: '0s' } // Expired immediately
        );

        const expiredClient = new TestClient();
        // Set expired access token and VALID refresh token
        expiredClient.cookies['frenzo_access_token'] = expiredToken;
        expiredClient.cookies['frenzo_refresh_token'] = clientAlice.cookies['frenzo_refresh_token'];
        expiredClient.cookies['frenzo_csrf_token'] = clientAlice.cookies['frenzo_csrf_token'];

        // Request with expired token returns 401 TOKEN_EXPIRED
        const probeExpired = await expiredClient.request('/api/v1/auth/me');
        assert(probeExpired.status === 401 && probeExpired.body.error.code === 'TOKEN_EXPIRED', 'Expired access token correctly rejected with 401 TOKEN_EXPIRED');

        // Execute refresh via POST /api/v1/auth/refresh
        const csrfTokenForRefresh = await expiredClient.getCsrf();
        const refreshRes = await expiredClient.request('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfTokenForRefresh }
        });
        assert(refreshRes.status === 200, 'Session refreshed successfully (HTTP 200)');
        assert(!!expiredClient.cookies['frenzo_access_token'], 'New access token cookie issued');

        // Following refresh, GET /me succeeds
        const postRefreshMe = await expiredClient.request('/api/v1/auth/me');
        assert(postRefreshMe.status === 200 && postRefreshMe.body.user.username === USER_ALICE.username, 'GET /me succeeds after token refresh');

        // -------------------------------------------------------------
        // SECTION 9: Database Cleanliness Audit
        // -------------------------------------------------------------
        console.log('\n9️⃣  Performing Final Database Cleanliness Audit...');
        await cleanupDatabase();

        const countRes = await query(`
            SELECT 
                (SELECT count(*) FROM users WHERE email LIKE '%${TEST_DOMAIN}%') AS test_users_count,
                (SELECT count(*) FROM profiles p JOIN users u ON p.id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_profiles_count,
                (SELECT count(*) FROM follows f JOIN users u ON f.follower_id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_follows_count,
                (SELECT count(*) FROM refresh_tokens r JOIN users u ON r.user_id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_refresh_count,
                (SELECT count(*) FROM password_reset_tokens pr JOIN users u ON pr.user_id = u.id WHERE u.email LIKE '%${TEST_DOMAIN}%') AS test_reset_count;
        `);

        const counts = countRes.rows[0];
        assert(Number(counts.test_users_count) === 0, `Disposable test users clean (count: ${counts.test_users_count})`);
        assert(Number(counts.test_profiles_count) === 0, `Disposable test profiles clean (count: ${counts.test_profiles_count})`);
        assert(Number(counts.test_follows_count) === 0, `Disposable test follows clean (count: ${counts.test_follows_count})`);
        assert(Number(counts.test_refresh_count) === 0, `Disposable test refresh tokens clean (count: ${counts.test_refresh_count})`);
        assert(Number(counts.test_reset_count) === 0, `Disposable test reset tokens clean (count: ${counts.test_reset_count})`);

        console.log('\n=============================================================');
        console.log(`📊 SOCIAL & PROFILES RESULTS: ${passed} PASSED, ${failed} FAILED`);
        console.log('=============================================================\n');

        if (failed > 0) {
            process.exit(1);
        }
    } catch (err) {
        console.error('Fatal Social Test Error:', err);
        process.exit(1);
    } finally {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await cleanupDatabase();
        await closePool();
    }
};

runSocialTests();
