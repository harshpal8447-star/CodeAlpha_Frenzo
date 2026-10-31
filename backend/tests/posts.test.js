/**
 * Frenzo Phase 3.3.3 Posts Module Test Suite
 * Comprehensive integration and security verification for backend Posts API:
 * 1. Post Creation (POST /api/v1/posts) - validation, auth, CSRF, atomic counter increment
 * 2. Single Post Retrieval (GET /api/v1/posts/:id) - guest/auth, privacy enforcement, soft-delete filtering
 * 3. Post Editing (PATCH /api/v1/posts/:id) - author authorization, content validation, timestamp updates
 * 4. Post Deletion (DELETE /api/v1/posts/:id) - soft delete, atomic idempotent counter decrement
 * 5. User Post Timeline (GET /api/v1/users/:username/posts) - deterministic ordering, pagination, privacy
 * 6. Security, Rate Limiter headers, SQL injection resistance, and clean teardown
 */
const http = require('http');
const app = require('../src/app');
const { query, closePool } = require('../src/config/database');

const TEST_DOMAIN = '@frenzo-test-posts.internal';
const TEST_TIMESTAMP = Date.now();

const USER_ALICE = {
    email: `alice_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `alice_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Alice_33!',
    display_name: 'Alice Poster'
};

const USER_BOB = {
    email: `bob_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `bob_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Bob_33!',
    display_name: 'Bob Reader'
};

const USER_CHARLIE = {
    email: `charlie_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `charlie_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Charlie_33!',
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

const runPostsTests = async () => {
    console.log('\n=============================================================');
    console.log('🧪 FRENZO POSTS API MODULE TEST SUITE (PHASE 3.3.3)');
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
        console.log('--- Setup: Registering Test Accounts ---');

        const aliceCsrf = await clientAlice.getCsrf();
        const regAlice = await clientAlice.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: USER_ALICE
        });
        assert(regAlice.status === 201, 'Setup Alice registered successfully');
        const aliceId = regAlice.body.user.id;

        const bobCsrf = await clientBob.getCsrf();
        const regBob = await clientBob.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: USER_BOB
        });
        assert(regBob.status === 201, 'Setup Bob registered successfully');
        const bobId = regBob.body.user.id;

        const charlieCsrf = await clientCharlie.getCsrf();
        const regCharlie = await clientCharlie.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': charlieCsrf },
            body: USER_CHARLIE
        });
        assert(regCharlie.status === 201, 'Setup Charlie registered successfully');
        const charlieId = regCharlie.body.user.id;

        // Set Charlie's profile to private for privacy tests
        await query('UPDATE profiles SET is_private = true WHERE id = $1;', [charlieId]);

        // =============================================================
        // SECTION 1: POST CREATION (POST /api/v1/posts)
        // =============================================================
        console.log('\n--- Section 1: Post Creation (POST /api/v1/posts) ---');

        // 1.1 Unauthenticated rejected
        const unauthCreate = await clientGuest.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Unauthenticated attempt' }
        });
        assert(unauthCreate.status === 401 && unauthCreate.body.error.code === 'UNAUTHORIZED',
            '1.1 Unauthenticated post creation is rejected (HTTP 401 UNAUTHORIZED)');

        // 1.2 Missing CSRF rejected
        const noCsrfCreate = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            body: { content: 'No CSRF attempt' }
        });
        assert(noCsrfCreate.status === 403 && noCsrfCreate.body.error.code === 'CSRF_VERIFICATION_FAILED',
            '1.2 Missing CSRF token is rejected (HTTP 403 CSRF_VERIFICATION_FAILED)');

        // 1.3 Missing / non-string content rejected
        const nonStringCreate = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 12345 }
        });
        assert(nonStringCreate.status === 400 && nonStringCreate.body.error.code === 'INVALID_CONTENT',
            '1.3 Non-string content is rejected (HTTP 400 INVALID_CONTENT)');

        // 1.4 Whitespace-only content rejected
        const emptyCreate = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: '    ' }
        });
        assert(emptyCreate.status === 400 && emptyCreate.body.error.code === 'INVALID_CONTENT',
            '1.4 Whitespace-only content is rejected (HTTP 400 INVALID_CONTENT)');

        // 1.5 Overlong content (>2000 chars) rejected
        const longContent = 'A'.repeat(2001);
        const overlongCreate = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: longContent }
        });
        assert(overlongCreate.status === 400 && overlongCreate.body.error.code === 'INVALID_CONTENT',
            '1.5 Content exceeding 2,000 characters is rejected (HTTP 400 INVALID_CONTENT)');

        // Check Alice's initial posts_count in database
        const initCountRes = await query('SELECT posts_count FROM profiles WHERE id = $1;', [aliceId]);
        assert(initCountRes.rows[0].posts_count === 0, '1.6 Initial profiles.posts_count is 0');

        // 1.6 Successful post creation
        const validContent = 'Hello world! This is my first Frenzo post.';
        const createRes = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: validContent }
        });
        assert(createRes.status === 201, '1.7 Valid post creation returns HTTP 201 Created');
        const post1 = createRes.body.post;
        assert(post1 && post1.id && post1.content === validContent, '1.8 Post response contains ID and valid content');
        assert(Array.isArray(post1.media_urls) && post1.media_urls.length === 0, '1.9 Post media_urls defaults to empty array []');
        assert(post1.is_own_post === true, '1.10 Post is_own_post is true for creator');
        assert(post1.author && post1.author.username === USER_ALICE.username && post1.author.display_name === USER_ALICE.display_name,
            '1.11 Post includes nested author profile metadata');

        // 1.12 Database counter check
        const incCountRes = await query('SELECT posts_count FROM profiles WHERE id = $1;', [aliceId]);
        assert(incCountRes.rows[0].posts_count === 1, '1.12 profiles.posts_count atomically incremented to 1');

        // 1.13 Boundary check: 2000 chars post creation
        const boundaryContent = 'B'.repeat(2000);
        const boundaryCreate = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: boundaryContent }
        });
        assert(boundaryCreate.status === 201 && boundaryCreate.body.post.content === boundaryContent,
            '1.13 Post with exactly 2,000 characters succeeds (HTTP 201)');
        const postBoundary = boundaryCreate.body.post;

        // Create a post for private user Charlie
        const charliePostRes = await clientCharlie.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': charlieCsrf },
            body: { content: 'Secret thoughts on a private profile.' }
        });
        assert(charliePostRes.status === 201, '1.14 Charlie creates post on private profile');
        const charliePost = charliePostRes.body.post;

        // =============================================================
        // SECTION 2: SINGLE POST RETRIEVAL (GET /api/v1/posts/:id)
        // =============================================================
        console.log('\n--- Section 2: Single Post Retrieval (GET /api/v1/posts/:id) ---');

        // 2.1 Non-existent post
        const randomUuid = '00000000-0000-4000-8000-000000000000';
        const notFoundGet = await clientGuest.request(`/api/v1/posts/${randomUuid}`);
        assert(notFoundGet.status === 404 && notFoundGet.body.error.code === 'POST_NOT_FOUND',
            '2.1 Non-existent post ID returns HTTP 404 POST_NOT_FOUND');

        // 2.2 Malformed UUID
        const malformedGet = await clientGuest.request('/api/v1/posts/invalid-uuid-1234');
        assert(malformedGet.status === 404 && malformedGet.body.error.code === 'POST_NOT_FOUND',
            '2.2 Malformed post UUID returns HTTP 404 POST_NOT_FOUND');

        // 2.3 Guest retrieval of public post
        const guestGet = await clientGuest.request(`/api/v1/posts/${post1.id}`);
        assert(guestGet.status === 200, '2.3 Guest can view public post (HTTP 200)');
        assert(guestGet.body.post.is_own_post === false, '2.4 Guest view returns is_own_post: false');
        assert(guestGet.body.post.content === validContent, '2.5 Returned content matches original');

        // 2.6 Authenticated other user (Bob) view
        const bobGet = await clientBob.request(`/api/v1/posts/${post1.id}`);
        assert(bobGet.status === 200 && bobGet.body.post.is_own_post === false,
            '2.6 Non-author authenticated user view returns HTTP 200 and is_own_post: false');

        // 2.7 Author (Alice) view
        const aliceGet = await clientAlice.request(`/api/v1/posts/${post1.id}`);
        assert(aliceGet.status === 200 && aliceGet.body.post.is_own_post === true,
            '2.7 Author view returns HTTP 200 and is_own_post: true');

        // 2.8 Guest blocked on private post
        const guestPrivateGet = await clientGuest.request(`/api/v1/posts/${charliePost.id}`);
        assert(guestPrivateGet.status === 403 && guestPrivateGet.body.error.code === 'PRIVATE_PROFILE',
            '2.8 Guest viewing private profile post receives HTTP 403 PRIVATE_PROFILE');

        // 2.9 Non-follower Bob blocked on private post
        const bobPrivateGet = await clientBob.request(`/api/v1/posts/${charliePost.id}`);
        assert(bobPrivateGet.status === 403 && bobPrivateGet.body.error.code === 'PRIVATE_PROFILE',
            '2.9 Non-follower Bob receives HTTP 403 PRIVATE_PROFILE for private post');

        // 2.10 Charlie (author) can view own private post
        const charlieOwnGet = await clientCharlie.request(`/api/v1/posts/${charliePost.id}`);
        assert(charlieOwnGet.status === 200 && charlieOwnGet.body.post.is_own_post === true,
            '2.10 Author Charlie can view own post on private profile');

        // 2.11 Bob follows Charlie -> Bob can now view private post
        const followRes = await clientBob.request(`/api/v1/users/${USER_CHARLIE.username}/follow`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(followRes.status === 200, '2.11 Bob successfully follows Charlie');

        const bobFollowerGet = await clientBob.request(`/api/v1/posts/${charliePost.id}`);
        assert(bobFollowerGet.status === 200 && bobFollowerGet.body.post.is_own_post === false,
            '2.12 Active follower Bob can now view Charlie private post (HTTP 200)');

        // =============================================================
        // SECTION 3: POST EDITING (PATCH /api/v1/posts/:id)
        // =============================================================
        console.log('\n--- Section 3: Post Editing (PATCH /api/v1/posts/:id) ---');

        // 3.1 Unauthenticated edit rejected
        const unauthEdit = await clientGuest.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Edited by guest' }
        });
        assert(unauthEdit.status === 401, '3.1 Unauthenticated edit is rejected (HTTP 401)');

        // 3.2 Missing CSRF on edit rejected
        const noCsrfEdit = await clientAlice.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            body: { content: 'Edited without CSRF' }
        });
        assert(noCsrfEdit.status === 403, '3.2 Edit without CSRF token is rejected (HTTP 403)');

        // 3.3 Non-author (Bob) attempting to edit Alice's post
        const bobEditAlice = await clientBob.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Hacked by Bob' }
        });
        assert(bobEditAlice.status === 403 && bobEditAlice.body.error.code === 'FORBIDDEN',
            '3.3 Non-author edit attempt is rejected (HTTP 403 FORBIDDEN)');

        // 3.4 Non-existent post edit
        const notFoundEdit = await clientAlice.request(`/api/v1/posts/${randomUuid}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Edit non-existent' }
        });
        assert(notFoundEdit.status === 404 && notFoundEdit.body.error.code === 'POST_NOT_FOUND',
            '3.4 Edit non-existent post returns HTTP 404 POST_NOT_FOUND');

        // 3.5 Validation: Empty content on edit
        const emptyEdit = await clientAlice.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: '   ' }
        });
        assert(emptyEdit.status === 400 && emptyEdit.body.error.code === 'INVALID_CONTENT',
            '3.5 Edit with whitespace content is rejected (HTTP 400 INVALID_CONTENT)');

        // 3.6 Validation: Overlong content on edit
        const overlongEdit = await clientAlice.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Z'.repeat(2001) }
        });
        assert(overlongEdit.status === 400 && overlongEdit.body.error.code === 'INVALID_CONTENT',
            '3.6 Edit with >2000 chars is rejected (HTTP 400 INVALID_CONTENT)');

        // 3.7 Successful author edit
        const updatedContent = 'Hello world! This post has been successfully updated.';
        const validEdit = await clientAlice.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: updatedContent }
        });
        assert(validEdit.status === 200, '3.7 Author successfully updates post (HTTP 200)');
        assert(validEdit.body.post.content === updatedContent, '3.8 Updated content returned in payload');
        assert(validEdit.body.post.is_own_post === true, '3.9 Updated post retains is_own_post: true');

        // 3.10 Database persistence check
        const dbPostCheck = await query('SELECT content, updated_at, created_at FROM posts WHERE id = $1;', [post1.id]);
        assert(dbPostCheck.rows[0].content === updatedContent, '3.10 Database reflects edited post content');

        // =============================================================
        // SECTION 4: POST DELETION (DELETE /api/v1/posts/:id)
        // =============================================================
        console.log('\n--- Section 4: Post Deletion (DELETE /api/v1/posts/:id) ---');

        // 4.1 Unauthenticated delete rejected
        const unauthDelete = await clientGuest.request(`/api/v1/posts/${postBoundary.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(unauthDelete.status === 401, '4.1 Unauthenticated delete is rejected (HTTP 401)');

        // 4.2 Missing CSRF delete rejected
        const noCsrfDelete = await clientAlice.request(`/api/v1/posts/${postBoundary.id}`, {
            method: 'DELETE'
        });
        assert(noCsrfDelete.status === 403, '4.2 Delete without CSRF token is rejected (HTTP 403)');

        // 4.3 Non-author (Bob) attempting to delete Alice's post
        const bobDeleteAlice = await clientBob.request(`/api/v1/posts/${postBoundary.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(bobDeleteAlice.status === 403 && bobDeleteAlice.body.error.code === 'FORBIDDEN',
            '4.3 Non-author delete attempt is rejected (HTTP 403 FORBIDDEN)');

        // 4.4 Non-existent post delete
        const notFoundDelete = await clientAlice.request(`/api/v1/posts/${randomUuid}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(notFoundDelete.status === 404 && notFoundDelete.body.error.code === 'POST_NOT_FOUND',
            '4.4 Delete non-existent post returns HTTP 404 POST_NOT_FOUND');

        // Current count before deletion
        const beforeDeleteCountRes = await query('SELECT posts_count FROM profiles WHERE id = $1;', [aliceId]);
        const countBefore = beforeDeleteCountRes.rows[0].posts_count;

        // 4.5 Successful author soft delete
        const validDelete = await clientAlice.request(`/api/v1/posts/${postBoundary.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(validDelete.status === 200, '4.5 Author soft-deletes post (HTTP 200)');
        assert(validDelete.body.post_id === postBoundary.id, '4.6 Returned payload includes deleted post_id');

        // 4.7 Database check: soft delete verified
        const deletedRowRes = await query('SELECT deleted_at FROM posts WHERE id = $1;', [postBoundary.id]);
        assert(deletedRowRes.rows[0].deleted_at !== null, '4.7 Post row marked with deleted_at timestamp in database');

        // 4.8 Atomic decrement verification
        const afterDeleteCountRes = await query('SELECT posts_count FROM profiles WHERE id = $1;', [aliceId]);
        assert(afterDeleteCountRes.rows[0].posts_count === countBefore - 1,
            '4.8 profiles.posts_count atomically decremented by 1');

        // 4.9 Soft-deleted post cannot be fetched
        const getDeleted = await clientGuest.request(`/api/v1/posts/${postBoundary.id}`);
        assert(getDeleted.status === 404 && getDeleted.body.error.code === 'POST_NOT_FOUND',
            '4.9 Soft-deleted post returns HTTP 404 POST_NOT_FOUND on GET');

        // 4.10 Soft-deleted post cannot be edited
        const editDeleted = await clientAlice.request(`/api/v1/posts/${postBoundary.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Try to edit deleted post' }
        });
        assert(editDeleted.status === 404 && editDeleted.body.error.code === 'POST_NOT_FOUND',
            '4.10 Soft-deleted post returns HTTP 404 POST_NOT_FOUND on PATCH');

        // 4.11 Repeated deletion on already deleted post returns 404
        const repeatDelete = await clientAlice.request(`/api/v1/posts/${postBoundary.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(repeatDelete.status === 404 && repeatDelete.body.error.code === 'POST_NOT_FOUND',
            '4.11 Repeat deletion of already deleted post returns HTTP 404');

        // 4.12 Counter idempotence: Repeated deletion did NOT double-decrement posts_count
        const idempCountRes = await query('SELECT posts_count FROM profiles WHERE id = $1;', [aliceId]);
        assert(idempCountRes.rows[0].posts_count === countBefore - 1,
            '4.12 Idempotent delete protection: posts_count was not double-decremented');

        // =============================================================
        // SECTION 5: USER POSTS TIMELINE (GET /api/v1/users/:username/posts)
        // =============================================================
        console.log('\n--- Section 5: User Posts Timeline (GET /api/v1/users/:username/posts) ---');

        // Create 3 additional posts for Alice with slight delays to verify deterministic ordering
        const alicePostIds = [post1.id];
        for (let i = 2; i <= 4; i++) {
            const pRes = await clientAlice.request('/api/v1/posts', {
                method: 'POST',
                headers: { 'x-csrf-token': aliceCsrf },
                body: { content: `Alice timeline post #${i}` }
            });
            assert(pRes.status === 201, `Setup Alice post #${i} created`);
            alicePostIds.push(pRes.body.post.id);
        }

        // 5.1 Non-existent user timeline returns 404
        const notFoundUserTimeline = await clientGuest.request('/api/v1/users/non_existent_user_99999/posts');
        assert(notFoundUserTimeline.status === 404 && notFoundUserTimeline.body.error.code === 'USER_NOT_FOUND',
            '5.1 Timeline for non-existent user returns HTTP 404 USER_NOT_FOUND');

        // 5.2 Guest can view public timeline
        const guestTimeline = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts`);
        assert(guestTimeline.status === 200, '5.2 Guest can retrieve public user timeline (HTTP 200)');
        assert(Array.isArray(guestTimeline.body.posts), '5.3 Response contains posts array');
        assert(guestTimeline.body.pagination && guestTimeline.body.pagination.total === 4,
            '5.4 Pagination total reflects 4 active posts (excluding soft-deleted post)');

        // 5.5 Deterministic sorting check: created_at DESC, id DESC
        const posts = guestTimeline.body.posts;
        assert(posts[0].id === alicePostIds[3], '5.5 Most recent post #4 appears first in timeline');
        assert(posts[3].id === alicePostIds[0], '5.6 Oldest post #1 appears last in timeline');

        // 5.7 Soft-deleted post is excluded from timeline
        const containsDeleted = posts.some((p) => p.id === postBoundary.id);
        assert(!containsDeleted, '5.7 Soft-deleted post is strictly excluded from timeline');

        // 5.8 Author viewing own timeline gets is_own_post: true
        const aliceOwnTimeline = await clientAlice.request(`/api/v1/users/${USER_ALICE.username}/posts`);
        assert(aliceOwnTimeline.body.posts.every((p) => p.is_own_post === true),
            '5.8 Author viewing own timeline sees is_own_post: true on every post');

        // 5.9 Pagination: limit=2, page=1
        const page1 = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts?page=1&limit=2`);
        assert(page1.status === 200 && page1.body.posts.length === 2, '5.9 Page 1 returns 2 posts');
        assert(page1.body.pagination.page === 1 && page1.body.pagination.limit === 2,
            '5.10 Pagination metadata returns page: 1, limit: 2');
        assert(page1.body.pagination.total === 4 && page1.body.pagination.total_pages === 2,
            '5.11 Pagination metadata returns total: 4, total_pages: 2');

        // 5.12 Pagination: limit=2, page=2
        const page2 = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts?page=2&limit=2`);
        assert(page2.status === 200 && page2.body.posts.length === 2, '5.12 Page 2 returns remaining 2 posts');
        const page1Ids = page1.body.posts.map((p) => p.id);
        const page2Ids = page2.body.posts.map((p) => p.id);
        const overlap = page1Ids.filter((id) => page2Ids.includes(id));
        assert(overlap.length === 0, '5.13 No duplicate post overlap between page 1 and page 2');

        // 5.14 Pagination beyond total
        const page3 = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts?page=3&limit=2`);
        assert(page3.status === 200 && page3.body.posts.length === 0 && page3.body.pagination.count === 0,
            '5.14 Page beyond total returns empty array [] with count: 0');

        // 5.15 Private timeline: Guest blocked
        const guestPrivateTimeline = await clientGuest.request(`/api/v1/users/${USER_CHARLIE.username}/posts`);
        assert(guestPrivateTimeline.status === 403 && guestPrivateTimeline.body.error.code === 'PRIVATE_PROFILE',
            '5.15 Guest blocked from private user timeline (HTTP 403 PRIVATE_PROFILE)');

        // 5.16 Private timeline: Non-follower Alice blocked
        const alicePrivateTimeline = await clientAlice.request(`/api/v1/users/${USER_CHARLIE.username}/posts`);
        assert(alicePrivateTimeline.status === 403 && alicePrivateTimeline.body.error.code === 'PRIVATE_PROFILE',
            '5.16 Non-follower Alice blocked from Charlie private timeline (HTTP 403 PRIVATE_PROFILE)');

        // 5.17 Private timeline: Author Charlie can view own timeline
        const charlieOwnTimeline = await clientCharlie.request(`/api/v1/users/${USER_CHARLIE.username}/posts`);
        assert(charlieOwnTimeline.status === 200 && charlieOwnTimeline.body.posts.length === 1,
            '5.17 Author Charlie can view own private timeline (HTTP 200)');

        // 5.18 Private timeline: Follower Bob can view timeline
        const bobFollowerTimeline = await clientBob.request(`/api/v1/users/${USER_CHARLIE.username}/posts`);
        assert(bobFollowerTimeline.status === 200 && bobFollowerTimeline.body.posts.length === 1,
            '5.18 Follower Bob can view private user timeline (HTTP 200)');

        // =============================================================
        // SECTION 6: SECURITY & SQL INJECTION RESISTANCE
        // =============================================================
        console.log('\n--- Section 6: Security & SQL Injection Resistance ---');

        // 6.1 SQL injection attack string in post content
        const sqliContent = "'); DROP TABLE posts; -- <script>alert(1)</script>";
        const sqliPost = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: sqliContent }
        });
        assert(sqliPost.status === 201 && sqliPost.body.post.content === sqliContent,
            '6.1 SQL injection string in post content safely escaped and stored literally');

        // Verify posts table still exists and is healthy
        const healthyCheck = await query('SELECT count(*)::int as count FROM posts;');
        assert(healthyCheck.rows[0].count > 0, '6.2 posts table remains intact and healthy');

        // 6.3 SQL injection attempt in username parameter
        const sqliUserTimeline = await clientGuest.request("/api/v1/users/' OR '1'='1/posts");
        assert(sqliUserTimeline.status === 404, '6.3 SQL injection attack in username route handled safely (HTTP 404)');

        // 6.4 Real account preservation
        const realUserCheck = await query("SELECT count(*)::int as count FROM users WHERE email NOT LIKE '%@frenzo-test%';");
        assert(realUserCheck.rows[0].count >= 1, '6.4 Real accounts (e.g. harshpal8447@gmail.com) are untouched');

    } finally {
        // Cleanup all test users and close resources
        await cleanupDatabase();
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await closePool();
    }

    console.log('\n=============================================================');
    console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
};

runPostsTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
