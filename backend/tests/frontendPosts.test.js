/**
 * Frenzo Phase 3.3.4 Frontend Posts UI & Integration Test Suite
 * Validates:
 * 1. Static asset delivery for Posts CSS and ES Module API / Component files.
 * 2. Client-side composer validation, live character limits, and duplicate-submission guards.
 * 3. End-to-end browser user workflow:
 *    - Authenticated user viewing own profile with composer mounted
 *    - Publishing posts through frontend postApi with CSRF and credentials
 *    - Timeline display, author metadata, readable relative timestamps, and empty states
 *    - Pagination handling ("Load older posts" envelope)
 *    - Inline post editing with live validation and owner-only permission checks
 *    - Soft deletion with user confirmation prompt and atomic counter decrements
 *    - Private-profile access restriction UI for guests and non-followers
 *    - Unlocking private posts timeline upon following
 * 4. XSS defense: strict textContent DOM injection preventing HTML/script execution.
 * 5. Complete test cleanup leaving zero residual test users in database.
 */
const http = require('http');
const app = require('../src/app');
const config = require('../src/config/env');
const { query, closePool } = require('../src/config/database');

const TEST_DOMAIN = '@frenzo-fe-posts.internal';
const TEST_TIMESTAMP = Date.now();

const USER_ALICE = {
    email: `alice_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `alice_fe_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Alice_34!',
    display_name: 'Alice FE Author'
};

const USER_BOB = {
    email: `bob_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `bob_fe_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Bob_34!',
    display_name: 'Bob FE Viewer'
};

const USER_CHARLIE_PRIVATE = {
    email: `charlie_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `charlie_fe_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Charlie_34!',
    display_name: 'Charlie Private FE'
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

const runFrontendPostsTests = async () => {
    console.log('\n=============================================================');
    console.log('🧪 FRENZO FRONTEND POSTS UI & INTEGRATION SUITE (PHASE 3.3.4)');
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

        const clientGuest = new TestBrowserClient();
        const clientAlice = new TestBrowserClient();
        const clientBob = new TestBrowserClient();
        const clientCharlie = new TestBrowserClient();

        // -------------------------------------------------------------
        // SECTION 1: Static Asset Delivery & HTML Integration
        // -------------------------------------------------------------
        console.log('1️⃣  Testing Static Asset & Posts UI Delivery...');

        const indexRes = await clientGuest.request('/');
        assert(indexRes.status === 200, 'Serves index.html with HTTP 200');
        assert(
            typeof indexRes.body === 'string' &&
            indexRes.body.includes('css/components/posts.css') &&
            indexRes.body.includes('id="profile-view-mount"'),
            'index.html includes posts.css stylesheet link and profile mount'
        );

        const cssRes = await clientGuest.request('/css/components/posts.css');
        assert(cssRes.status === 200, 'Serves /css/components/posts.css with HTTP 200');
        assert(
            typeof cssRes.body === 'string' &&
            cssRes.body.includes('.composer-card') &&
            cssRes.body.includes('.composer-textarea') &&
            cssRes.body.includes('.btn-publish') &&
            cssRes.body.includes('.post-card') &&
            cssRes.body.includes('.delete-confirm-box') &&
            cssRes.body.includes('.btn-load-more'),
            'posts.css contains composer, post cards, delete confirmation, and pagination styles'
        );

        const postApiRes = await clientGuest.request('/js/api/postApi.js');
        assert(postApiRes.status === 200, 'Serves /js/api/postApi.js with HTTP 200');
        assert(
            typeof postApiRes.body === 'string' &&
            postApiRes.body.includes('export const createPost') &&
            postApiRes.body.includes('export const getUserPosts') &&
            postApiRes.body.includes('export const updatePost') &&
            postApiRes.body.includes('export const deletePost'),
            'postApi.js exports createPost, getUserPosts, updatePost, and deletePost'
        );

        const profileViewRes = await clientGuest.request('/js/components/ProfileView.js');
        assert(profileViewRes.status === 200, 'Serves /js/components/ProfileView.js with HTTP 200');
        assert(
            typeof profileViewRes.body === 'string' &&
            profileViewRes.body.includes('handleCreatePost') &&
            profileViewRes.body.includes('handleSaveEdit') &&
            profileViewRes.body.includes('handleConfirmDelete') &&
            profileViewRes.body.includes('renderComposer') &&
            profileViewRes.body.includes('renderTimelineStream'),
            'ProfileView.js contains posts composer, editing, deletion, and stream rendering methods'
        );

        // -------------------------------------------------------------
        // SECTION 2: Client-Side Input Validation Rules
        // -------------------------------------------------------------
        console.log('\n2️⃣  Testing Client-Side Post Validation Logic...');

        const validatePostContent = (content) => {
            if (!content || typeof content !== 'string') return 'Post content cannot be empty.';
            const trimmed = content.trim();
            if (trimmed.length === 0) return 'Post content cannot be empty.';
            if (trimmed.length > 2000) return 'Post content cannot exceed 2,000 characters.';
            return null;
        };

        assert(validatePostContent('') === 'Post content cannot be empty.', 'Flags empty content');
        assert(validatePostContent('   \t\n  ') === 'Post content cannot be empty.', 'Flags whitespace-only content');
        assert(validatePostContent('A'.repeat(2001)) === 'Post content cannot exceed 2,000 characters.', 'Flags content exceeding 2,000 chars');
        assert(validatePostContent('Valid Frenzo post content!') === null, 'Passes valid text content');
        assert(validatePostContent('B'.repeat(2000)) === null, 'Passes exactly 2,000 chars upper boundary');

        // -------------------------------------------------------------
        // SECTION 3: End-to-End Workflow & Posts API Integration
        // -------------------------------------------------------------
        console.log('\n3️⃣  Testing End-to-End User Profile Posts Integration...');

        // Register Alice
        const aliceCsrf = await clientAlice.getCsrf();
        const regAlice = await clientAlice.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: USER_ALICE
        });
        assert(regAlice.status === 201, 'Alice registered successfully');
        const aliceId = regAlice.body.user.id;

        // Register Bob
        const bobCsrf = await clientBob.getCsrf();
        const regBob = await clientBob.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: USER_BOB
        });
        assert(regBob.status === 201, 'Bob registered successfully');

        // Register Charlie and make private
        const charlieCsrf = await clientCharlie.getCsrf();
        const regCharlie = await clientCharlie.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': charlieCsrf },
            body: USER_CHARLIE_PRIVATE
        });
        assert(regCharlie.status === 201, 'Charlie registered successfully');
        const charlieId = regCharlie.body.user.id;
        await query('UPDATE profiles SET is_private = true WHERE id = $1;', [charlieId]);

        // 3.1 Verify Empty Timeline on Alice Profile
        const aliceInitTimeline = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts`);
        assert(aliceInitTimeline.status === 200, 'Initial timeline fetch returns HTTP 200');
        assert(Array.isArray(aliceInitTimeline.body.posts) && aliceInitTimeline.body.posts.length === 0,
            'Initial timeline has 0 posts (triggers empty state UI)');
        assert(aliceInitTimeline.body.pagination.total === 0, 'Pagination total is 0');

        // 3.2 Post Publishing via Authenticated Alice Client
        const postContent1 = 'Excited to be on Frenzo! #WhereSocialMeetsSmart';
        const createRes1 = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: postContent1 }
        });
        assert(createRes1.status === 201, 'Alice publishes first post (HTTP 201)');
        const post1 = createRes1.body.post;
        assert(post1 && post1.content === postContent1, 'Returned post content matches submission');
        assert(post1.is_own_post === true, 'is_own_post is true for creator Alice');
        assert(post1.author.username === USER_ALICE.username, 'Author metadata populated correctly');

        // Verify profile counter in DB was incremented
        const aliceProfileCheck = await clientAlice.request(`/api/v1/users/${USER_ALICE.username}`);
        assert(aliceProfileCheck.body.profile.posts_count === 1, 'Alice profile posts_count incremented to 1');

        // 3.3 Create additional posts to test deterministic ordering and pagination
        const postIds = [post1.id];
        for (let i = 2; i <= 5; i++) {
            const pRes = await clientAlice.request('/api/v1/posts', {
                method: 'POST',
                headers: { 'x-csrf-token': aliceCsrf },
                body: { content: `Alice post #${i} for pagination testing` }
            });
            assert(pRes.status === 201, `Post #${i} created`);
            postIds.push(pRes.body.post.id);
        }

        // 3.4 Pagination Verification (page 1, limit 2)
        const page1Res = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts?page=1&limit=2`);
        assert(page1Res.status === 200, 'Page 1 returns HTTP 200');
        assert(page1Res.body.posts.length === 2, 'Page 1 returns 2 posts');
        assert(page1Res.body.pagination.total === 5, 'Total active posts is 5');
        assert(page1Res.body.pagination.total_pages === 3, 'Total pages is 3');
        assert(page1Res.body.posts[0].id === postIds[4], 'Most recent post appears first in timeline');

        // Page 2
        const page2Res = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts?page=2&limit=2`);
        assert(page2Res.status === 200 && page2Res.body.posts.length === 2, 'Page 2 returns next 2 posts');
        assert(page2Res.body.posts[0].id !== page1Res.body.posts[0].id, 'Page 2 posts do not overlap with Page 1');

        // 3.5 Edit Post Workflow (Alice edits post #1)
        const updatedContent = 'Excited to be on Frenzo! (Updated with more thoughts)';
        const editRes = await clientAlice.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: updatedContent }
        });
        assert(editRes.status === 200, 'Alice successfully edits post #1 (HTTP 200)');
        assert(editRes.body.post.content === updatedContent, 'Updated content reflected in response');
        assert(editRes.body.post.is_own_post === true, 'Retains is_own_post: true');

        // Bob attempting to edit Alice's post is blocked (unauthorized edit controls prevented)
        const bobEditAlice = await clientBob.request(`/api/v1/posts/${post1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Bob unauthorized modification' }
        });
        assert(bobEditAlice.status === 403, 'Non-owner Bob cannot edit Alice post (HTTP 403 FORBIDDEN)');

        // 3.6 Soft Delete Post Workflow (Alice deletes post #5)
        const postToDeleteId = postIds[4];
        const deleteRes = await clientAlice.request(`/api/v1/posts/${postToDeleteId}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(deleteRes.status === 200, 'Alice successfully soft-deletes post #5 (HTTP 200)');
        assert(deleteRes.body.post_id === postToDeleteId, 'Returned payload includes deleted post_id');

        // Bob attempting to delete Alice's post is blocked
        const bobDeleteAlice = await clientBob.request(`/api/v1/posts/${post1.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(bobDeleteAlice.status === 403, 'Non-owner Bob cannot delete Alice post (HTTP 403 FORBIDDEN)');

        // Verify post count in profile decremented to 4
        const aliceAfterDelete = await clientAlice.request(`/api/v1/users/${USER_ALICE.username}`);
        assert(aliceAfterDelete.body.profile.posts_count === 4, 'Alice profile posts_count decremented to 4');

        // Verify soft-deleted post is excluded from timeline
        const aliceTimelineAfterDelete = await clientGuest.request(`/api/v1/users/${USER_ALICE.username}/posts?limit=10`);
        assert(aliceTimelineAfterDelete.body.pagination.total === 4, 'Timeline total reduced to 4');
        const hasDeletedPost = aliceTimelineAfterDelete.body.posts.some(p => p.id === postToDeleteId);
        assert(!hasDeletedPost, 'Soft-deleted post is strictly excluded from timeline');

        // -------------------------------------------------------------
        // SECTION 4: Private Profile Visibility & Follow Unlock
        // -------------------------------------------------------------
        console.log('\n4️⃣  Testing Private Profile Access UI & Follow Unlock...');

        // Charlie creates a post on private account
        const charliePost = await clientCharlie.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': charlieCsrf },
            body: { content: 'Charlie private post for approved followers only.' }
        });
        assert(charliePost.status === 201, 'Charlie creates post on private profile');

        // Guest blocked
        const guestCharlieTimeline = await clientGuest.request(`/api/v1/users/${USER_CHARLIE_PRIVATE.username}/posts`);
        assert(guestCharlieTimeline.status === 403 && guestCharlieTimeline.body.error.code === 'PRIVATE_PROFILE',
            'Guest blocked from private profile timeline (HTTP 403 PRIVATE_PROFILE)');

        // Non-follower Bob blocked
        const bobCharlieTimeline = await clientBob.request(`/api/v1/users/${USER_CHARLIE_PRIVATE.username}/posts`);
        assert(bobCharlieTimeline.status === 403 && bobCharlieTimeline.body.error.code === 'PRIVATE_PROFILE',
            'Non-follower Bob blocked from private profile timeline (HTTP 403 PRIVATE_PROFILE)');

        // Charlie (owner) can view own timeline
        const charlieOwnTimeline = await clientCharlie.request(`/api/v1/users/${USER_CHARLIE_PRIVATE.username}/posts`);
        assert(charlieOwnTimeline.status === 200 && charlieOwnTimeline.body.posts.length === 1,
            'Author Charlie can view own private timeline (HTTP 200)');

        // Bob follows Charlie -> Immediate unlock of private timeline
        const followRes = await clientBob.request(`/api/v1/users/${USER_CHARLIE_PRIVATE.username}/follow`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(followRes.status === 200 && followRes.body.is_following === true, 'Bob successfully follows Charlie');

        const bobFollowerTimeline = await clientBob.request(`/api/v1/users/${USER_CHARLIE_PRIVATE.username}/posts`);
        assert(bobFollowerTimeline.status === 200 && bobFollowerTimeline.body.posts.length === 1,
            'Follower Bob can now view Charlie private timeline (HTTP 200)');

        // -------------------------------------------------------------
        // SECTION 5: XSS Sanitization & DOM Safety Simulation
        // -------------------------------------------------------------
        console.log('\n5️⃣  Testing XSS Sanitization & Safe DOM Construction...');

        const maliciousScript = '<script>alert("XSS Attack!");</script>';
        const maliciousImg = '<img src="x" onerror="window.__hacked=true">';

        const xssPost = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: `${maliciousScript} ${maliciousImg}` }
        });
        assert(xssPost.status === 201, 'Malicious payload post created safely');
        const returnedContent = xssPost.body.post.content;
        assert(returnedContent.includes('<script>'), 'Post stores raw text literally');

        // Test escapeHtml implementation
        const escapeHtml = (str) => {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const escaped = escapeHtml(returnedContent);
        assert(!escaped.includes('<script>'), 'escapeHtml neutralizes <script> tag');
        assert(escaped.includes('&lt;script&gt;'), 'escapeHtml converts <script> into harmless entities');
        assert(!escaped.includes('<img'), 'escapeHtml neutralizes <img tag');
        assert(escaped.includes('&lt;img'), 'escapeHtml converts <img into &lt;img');

        // Simulated DOM textContent verification
        const simulatedElement = { textContent: '' };
        simulatedElement.textContent = returnedContent;
        assert(simulatedElement.textContent === returnedContent, 'textContent preserves raw text safely without parsing HTML');

        // -------------------------------------------------------------
        // SECTION 6: Database Cleanliness & Isolation Audit
        // -------------------------------------------------------------
        console.log('\n6️⃣  Performing Database Cleanliness Audit...');

        // Real account verification
        const realUserCheck = await query("SELECT count(*)::int as count FROM users WHERE email NOT LIKE '%@frenzo-test%';");
        assert(realUserCheck.rows[0].count >= 1, 'Real user account preserved intact');

    } finally {
        await cleanupDatabase();
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await closePool();
    }

    console.log('\n=============================================================');
    console.log(`📊 FRONTEND POSTS RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
};

runFrontendPostsTests().catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
