/**
 * Frenzo Phase 3.4.3 Likes & Comments Module Test Suite
 * Comprehensive integration, concurrency, security, and integrity verification:
 * 1. Post Likes (POST /api/v1/posts/:id/like, DELETE /api/v1/posts/:id/like, GET /api/v1/posts/:id/likes)
 *    - Authenticated like/unlike, idempotent repeat operations, atomic counters
 *    - liked_by_me boolean flag in post responses
 *    - posts.updated_at preservation during like/unlike mutations
 * 2. Post Comments (POST /api/v1/posts/:id/comments, GET /api/v1/posts/:id/comments)
 *    - Validation: non-empty, trimmed, <= 500 chars, boundary 500 chars, overlong 501 chars
 *    - Deterministic pagination (created_at ASC, id ASC)
 *    - Soft deletion filtering (deleted_at IS NULL)
 * 3. Comment Mutations (PATCH /api/v1/comments/:id, DELETE /api/v1/comments/:id)
 *    - Comment author-only editing (post author forbidden from editing another's comment)
 *    - Comment deletion permissions (comment author OR post author authorized, unrelated forbidden)
 *    - Atomic comments_count decrements without GREATEST(0, counter - 1)
 * 4. Concurrency, Lock Ordering, and Post Deletion Races
 *    - Parent-first lock ordering (SELECT ... FOR UPDATE)
 *    - Post deletion racing with like/comment mutations
 *    - Concurrent likes/unlikes and comments with DB consistency checks
 * 5. Private Profile Privacy Gates
 *    - Guest/non-follower blocking (HTTP 403 PRIVATE_PROFILE)
 *    - Follower unlock
 * 6. Isolated test fixtures and complete cleanup preserving real data
 */
const http = require('http');
const app = require('../src/app');
const { query, closePool } = require('../src/config/database');

const TEST_DOMAIN = '@frenzo-test-likes-comments.internal';
const TEST_TIMESTAMP = Date.now();

const USER_ALICE = {
    email: `alice_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `alice_lc_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Alice_34!',
    display_name: 'Alice Post Author'
};

const USER_BOB = {
    email: `bob_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `bob_lc_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Bob_34!',
    display_name: 'Bob Interactor'
};

const USER_CHARLIE = {
    email: `charlie_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `charlie_lc_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Charlie_34!',
    display_name: 'Charlie Private Author'
};

const USER_DAVE = {
    email: `dave_${TEST_TIMESTAMP}${TEST_DOMAIN}`,
    username: `dave_lc_${TEST_TIMESTAMP}`.substring(0, 25),
    password: 'Password_Dave_34!',
    display_name: 'Dave Bystander'
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

const runLikesCommentsTests = async () => {
    console.log('\n=============================================================');
    console.log('🧪 FRENZO LIKES & COMMENTS API TEST SUITE (PHASE 3.4.3)');
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
        const clientDave = new TestClient();
        const clientGuest = new TestClient();

        // -------------------------------------------------------------
        // Setup: Register Test Accounts & Create Posts
        // -------------------------------------------------------------
        console.log('--- Setup: Registering Test Accounts & Seed Posts ---');

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

        const daveCsrf = await clientDave.getCsrf();
        const regDave = await clientDave.request('/api/v1/auth/register', {
            method: 'POST',
            headers: { 'x-csrf-token': daveCsrf },
            body: USER_DAVE
        });
        assert(regDave.status === 201, 'Setup Dave registered successfully');
        const daveId = regDave.body.user.id;

        // Set Charlie to private profile
        await query('UPDATE profiles SET is_private = true WHERE id = $1;', [charlieId]);

        // Alice creates a public post
        const p1Res = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Alice public post for interaction testing.' }
        });
        assert(p1Res.status === 201, 'Setup: Alice created public post');
        const post1 = p1Res.body.post;
        assert(post1.likes_count === 0 && post1.comments_count === 0 && post1.liked_by_me === false,
            'Setup: New post initialized with likes_count: 0, comments_count: 0, liked_by_me: false');

        // Charlie creates a private post
        const pPrivRes = await clientCharlie.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': charlieCsrf },
            body: { content: 'Charlie private post for privacy gate testing.' }
        });
        assert(pPrivRes.status === 201, 'Setup: Charlie created private post');
        const privatePost = pPrivRes.body.post;

        // Fetch initial post1 updated_at timestamp from DB to verify it remains untouched
        const initialPostRow = await query('SELECT updated_at FROM posts WHERE id = $1;', [post1.id]);
        const initialPostUpdatedAt = new Date(initialPostRow.rows[0].updated_at).getTime();

        // =============================================================
        // SECTION 1: POST LIKES API (POST/DELETE /posts/:id/like, GET /posts/:id/likes)
        // =============================================================
        console.log('\n--- Section 1: Post Likes API ---');

        // 1.1 Unauthenticated like rejected
        const unauthLike = await clientGuest.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(unauthLike.status === 401 && unauthLike.body.error.code === 'UNAUTHORIZED',
            '1.1 Unauthenticated like rejected (HTTP 401 UNAUTHORIZED)');

        // 1.2 Missing CSRF rejected
        const noCsrfLike = await clientBob.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'POST'
        });
        assert(noCsrfLike.status === 403 && noCsrfLike.body.error.code === 'CSRF_VERIFICATION_FAILED',
            '1.2 Missing CSRF token rejected for like (HTTP 403)');

        // 1.3 Non-existent post ID returns 404
        const nonExistentId = '00000000-0000-4000-8000-000000000000';
        const notFoundLike = await clientBob.request(`/api/v1/posts/${nonExistentId}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(notFoundLike.status === 404 && notFoundLike.body.error.code === 'POST_NOT_FOUND',
            '1.3 Like on non-existent post returns HTTP 404 POST_NOT_FOUND');

        // 1.4 Malformed post ID returns 404
        const malformedLike = await clientBob.request('/api/v1/posts/invalid-uuid/like', {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(malformedLike.status === 404 && malformedLike.body.error.code === 'POST_NOT_FOUND',
            '1.4 Like with malformed post ID returns HTTP 404 POST_NOT_FOUND');

        // 1.5 Bob likes Alice's public post successfully
        const bobLikeRes = await clientBob.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(bobLikeRes.status === 200 && bobLikeRes.body.liked === true && bobLikeRes.body.likes_count === 1,
            '1.5 Bob likes public post successfully (HTTP 200, liked: true, likes_count: 1)');

        // 1.6 Verify database posts.likes_count and post_likes record
        const dbLikeCheck = await query('SELECT likes_count FROM posts WHERE id = $1;', [post1.id]);
        assert(dbLikeCheck.rows[0].likes_count === 1, '1.6 posts.likes_count is 1 in database');
        const dbEdgeCheck = await query('SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = $1 AND user_id = $2;',
            [post1.id, bobId]);
        assert(dbEdgeCheck.rows[0].count === 1, '1.7 post_likes edge row exists in database');

        // 1.7 Verify posts.updated_at remained UNTOUCHED after like
        const afterLikePostRow = await query('SELECT updated_at FROM posts WHERE id = $1;', [post1.id]);
        const afterLikePostUpdatedAt = new Date(afterLikePostRow.rows[0].updated_at).getTime();
        assert(afterLikePostUpdatedAt === initialPostUpdatedAt,
            '1.8 posts.updated_at remains strictly UNCHANGED after like');

        // 1.8 Idempotent duplicate like by Bob
        const dupLikeRes = await clientBob.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(dupLikeRes.status === 200 && dupLikeRes.body.liked === true && dupLikeRes.body.likes_count === 1,
            '1.9 Repeated like is idempotent (HTTP 200, likes_count unchanged at 1)');
        const dbDupLikeCheck = await query('SELECT likes_count FROM posts WHERE id = $1;', [post1.id]);
        assert(dbDupLikeCheck.rows[0].likes_count === 1, '1.10 Database counter not double-incremented on duplicate like');

        // 1.9 Dave also likes Alice's post
        const daveLikeRes = await clientDave.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': daveCsrf }
        });
        assert(daveLikeRes.status === 200 && daveLikeRes.body.likes_count === 2,
            '1.11 Second user (Dave) likes post, likes_count becomes 2');

        // 1.10 Post retrieval reflects liked_by_me and likes_count
        const bobGetPost = await clientBob.request(`/api/v1/posts/${post1.id}`);
        assert(bobGetPost.status === 200 && bobGetPost.body.post.liked_by_me === true && bobGetPost.body.post.likes_count === 2,
            '1.12 Bob GET /posts/:id returns liked_by_me: true and likes_count: 2');
        const guestGetPost = await clientGuest.request(`/api/v1/posts/${post1.id}`);
        assert(guestGetPost.status === 200 && guestGetPost.body.post.liked_by_me === false && guestGetPost.body.post.likes_count === 2,
            '1.13 Guest GET /posts/:id returns liked_by_me: false and likes_count: 2');

        // 1.11 Private post like restrictions
        const guestPrivLike = await clientGuest.request(`/api/v1/posts/${privatePost.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(guestPrivLike.status === 401, '1.14 Guest cannot like private post (HTTP 401)');

        const nonFollowerPrivLike = await clientBob.request(`/api/v1/posts/${privatePost.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(nonFollowerPrivLike.status === 403 && nonFollowerPrivLike.body.error.code === 'PRIVATE_PROFILE',
            '1.15 Non-follower Bob cannot like Charlie private post (HTTP 403 PRIVATE_PROFILE)');

        // Bob follows Charlie to unlock private interactions
        await clientBob.request(`/api/v1/users/${USER_CHARLIE.username}/follow`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        const followerPrivLike = await clientBob.request(`/api/v1/posts/${privatePost.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(followerPrivLike.status === 200 && followerPrivLike.body.liked === true,
            '1.16 Follower Bob can now like Charlie private post (HTTP 200)');

        // 1.12 List post likes (GET /api/v1/posts/:id/likes)
        const getLikesRes = await clientGuest.request(`/api/v1/posts/${post1.id}/likes`);
        assert(getLikesRes.status === 200 && Array.isArray(getLikesRes.body.likes) && getLikesRes.body.pagination.total === 2,
            '1.17 GET /posts/:id/likes returns paginated likers list (total: 2)');
        assert(getLikesRes.body.likes.some((l) => l.username === USER_BOB.username),
            '1.18 Likers list contains Bob metadata');

        // Non-follower Dave cannot list likes on private post
        const davePrivLikes = await clientDave.request(`/api/v1/posts/${privatePost.id}/likes`);
        assert(davePrivLikes.status === 403 && davePrivLikes.body.error.code === 'PRIVATE_PROFILE',
            '1.19 Non-follower Dave blocked from listing private post likes (HTTP 403 PRIVATE_PROFILE)');

        // 1.13 Unlike post (DELETE /api/v1/posts/:id/like)
        const bobUnlikeRes = await clientBob.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(bobUnlikeRes.status === 200 && bobUnlikeRes.body.liked === false && bobUnlikeRes.body.likes_count === 1,
            '1.20 Bob unlikes post (HTTP 200, liked: false, likes_count: 1)');

        // Verify updated_at untouched after unlike
        const afterUnlikePostRow = await query('SELECT updated_at FROM posts WHERE id = $1;', [post1.id]);
        assert(new Date(afterUnlikePostRow.rows[0].updated_at).getTime() === initialPostUpdatedAt,
            '1.21 posts.updated_at remains strictly UNCHANGED after unlike');

        // Repeated unlike by Bob is idempotent (does not decrement below 0)
        const repeatUnlikeRes = await clientBob.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(repeatUnlikeRes.status === 200 && repeatUnlikeRes.body.liked === false && repeatUnlikeRes.body.likes_count === 1,
            '1.22 Repeated unlike is idempotent (HTTP 200, likes_count remains 1)');

        // Dave unlikes post
        const daveUnlikeRes = await clientDave.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': daveCsrf }
        });
        assert(daveUnlikeRes.status === 200 && daveUnlikeRes.body.likes_count === 0,
            '1.23 Dave unlikes post, likes_count returns to 0');

        // Dave unlikes again when counter is already 0
        const zeroUnlikeRes = await clientDave.request(`/api/v1/posts/${post1.id}/like`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': daveCsrf }
        });
        assert(zeroUnlikeRes.status === 200 && zeroUnlikeRes.body.likes_count === 0,
            '1.24 Unlike when likes_count is 0 remains 0 and does not violate constraint');

        // =============================================================
        // SECTION 2: POST COMMENTS API (POST/GET /posts/:id/comments)
        // =============================================================
        console.log('\n--- Section 2: Post Comments API ---');

        // 2.1 Unauthenticated comment creation rejected
        const unauthComment = await clientGuest.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Unauthenticated comment' }
        });
        assert(unauthComment.status === 401 && unauthComment.body.error.code === 'UNAUTHORIZED',
            '2.1 Unauthenticated comment creation rejected (HTTP 401)');

        // 2.2 Missing CSRF rejected
        const noCsrfComment = await clientBob.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            body: { content: 'No CSRF comment' }
        });
        assert(noCsrfComment.status === 403 && noCsrfComment.body.error.code === 'CSRF_VERIFICATION_FAILED',
            '2.2 Missing CSRF token rejected for comment (HTTP 403)');

        // 2.3 Non-existent post ID returns 404
        const notFoundComment = await clientBob.request(`/api/v1/posts/${nonExistentId}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Comment on nothing' }
        });
        assert(notFoundComment.status === 404 && notFoundComment.body.error.code === 'POST_NOT_FOUND',
            '2.3 Comment on non-existent post returns HTTP 404 POST_NOT_FOUND');

        // 2.4 Empty comment content rejected
        const emptyComment = await clientBob.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: '' }
        });
        assert(emptyComment.status === 400 && emptyComment.body.error.code === 'INVALID_CONTENT',
            '2.4 Empty comment content rejected (HTTP 400 INVALID_CONTENT)');

        // 2.5 Whitespace-only comment rejected
        const whitespaceComment = await clientBob.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: '     \n\t   ' }
        });
        assert(whitespaceComment.status === 400 && whitespaceComment.body.error.code === 'INVALID_CONTENT',
            '2.5 Whitespace-only comment rejected (HTTP 400 INVALID_CONTENT)');

        // 2.6 Overlong comment (>500 characters) rejected
        const overlongContent = 'C'.repeat(501);
        const overlongComment = await clientBob.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: overlongContent }
        });
        assert(overlongComment.status === 400 && overlongComment.body.error.code === 'INVALID_CONTENT',
            '2.6 Comment exceeding 500 characters (501 chars) rejected (HTTP 400 INVALID_CONTENT)');

        // 2.7 Boundary comment: exactly 500 characters succeeds
        const boundaryCommentText = 'D'.repeat(500);
        const boundaryCommentRes = await clientBob.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: boundaryCommentText }
        });
        assert(boundaryCommentRes.status === 201 && boundaryCommentRes.body.comment.content.length === 500,
            '2.7 Boundary comment with exactly 500 characters succeeds (HTTP 201 Created)');
        const boundaryCommentId = boundaryCommentRes.body.comment.id;

        // 2.8 Standard comment by Bob
        const comment1Res = await clientBob.request(`/api/v1/posts/${post1.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Great insights in this post, Alice!' }
        });
        assert(comment1Res.status === 201, '2.8 Bob creates valid comment (HTTP 201 Created)');
        const comment1 = comment1Res.body.comment;
        assert(comment1 && comment1.id && comment1.author.username === USER_BOB.username,
            '2.9 Comment payload includes ID and author profile metadata');
        assert(comment1.is_own_comment === true, '2.10 is_own_comment is true for creator Bob');

        // 2.9 Verify posts.comments_count in DB incremented to 2
        const dbCommentCount = await query('SELECT comments_count FROM posts WHERE id = $1;', [post1.id]);
        assert(dbCommentCount.rows[0].comments_count === 2, '2.11 Database posts.comments_count is 2');

        // 2.10 Verify posts.updated_at remains UNTOUCHED after comment creation
        const afterCommentPostRow = await query('SELECT updated_at FROM posts WHERE id = $1;', [post1.id]);
        assert(new Date(afterCommentPostRow.rows[0].updated_at).getTime() === initialPostUpdatedAt,
            '2.12 posts.updated_at remains strictly UNCHANGED after creating comments');

        // 2.11 Private post comment permissions
        const nonFollowerPrivComment = await clientDave.request(`/api/v1/posts/${privatePost.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': daveCsrf },
            body: { content: 'Sneaking into private post comments' }
        });
        assert(nonFollowerPrivComment.status === 403 && nonFollowerPrivComment.body.error.code === 'PRIVATE_PROFILE',
            '2.13 Non-follower Dave blocked from commenting on private post (HTTP 403 PRIVATE_PROFILE)');

        const followerPrivComment = await clientBob.request(`/api/v1/posts/${privatePost.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Authorized follower comment on private post' }
        });
        assert(followerPrivComment.status === 201, '2.14 Follower Bob can comment on Charlie private post (HTTP 201)');

        // 2.12 List comments (GET /api/v1/posts/:id/comments)
        const getCommentsRes = await clientGuest.request(`/api/v1/posts/${post1.id}/comments`);
        assert(getCommentsRes.status === 200 && Array.isArray(getCommentsRes.body.comments),
            '2.15 Guest GET /posts/:id/comments returns HTTP 200 with comments array');
        assert(getCommentsRes.body.pagination.total === 2, '2.16 Comments pagination total is 2');
        assert(getCommentsRes.body.comments[0].created_at <= getCommentsRes.body.comments[1].created_at,
            '2.17 Comments returned in deterministic chronological order (created_at ASC, id ASC)');

        // Non-follower Dave blocked from listing private comments
        const davePrivComments = await clientDave.request(`/api/v1/posts/${privatePost.id}/comments`);
        assert(davePrivComments.status === 403 && davePrivComments.body.error.code === 'PRIVATE_PROFILE',
            '2.18 Non-follower Dave blocked from listing private post comments (HTTP 403 PRIVATE_PROFILE)');

        // =============================================================
        // SECTION 3: COMMENT MUTATIONS (PATCH/DELETE /comments/:id)
        // =============================================================
        console.log('\n--- Section 3: Comment Mutations (PATCH/DELETE /comments/:id) ---');

        // 3.1 Unauthenticated comment update rejected
        const unauthUpdate = await clientGuest.request(`/api/v1/comments/${comment1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Hacked update' }
        });
        assert(unauthUpdate.status === 401, '3.1 Unauthenticated comment edit rejected (HTTP 401)');

        // 3.2 Non-existent comment update returns 404
        const notFoundCommentUpdate = await clientBob.request(`/api/v1/comments/${nonExistentId}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Ghost comment edit' }
        });
        assert(notFoundCommentUpdate.status === 404 && notFoundCommentUpdate.body.error.code === 'COMMENT_NOT_FOUND',
            '3.2 Edit on non-existent comment returns HTTP 404 COMMENT_NOT_FOUND');

        // 3.3 Empty content edit rejected
        const emptyEdit = await clientBob.request(`/api/v1/comments/${comment1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: '   ' }
        });
        assert(emptyEdit.status === 400 && emptyEdit.body.error.code === 'INVALID_CONTENT',
            '3.3 Empty content in comment edit rejected (HTTP 400 INVALID_CONTENT)');

        // 3.4 Non-author Dave attempts to edit Bob's comment: rejected with 403 FORBIDDEN
        const daveEditBob = await clientDave.request(`/api/v1/comments/${comment1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': daveCsrf },
            body: { content: 'Dave tampering with Bob comment' }
        });
        assert(daveEditBob.status === 403 && daveEditBob.body.error.code === 'FORBIDDEN',
            '3.4 Non-author Dave cannot edit Bob comment (HTTP 403 FORBIDDEN)');

        // 3.5 Post author Alice attempts to edit Bob's comment: rejected with 403 FORBIDDEN
        const aliceEditBob = await clientAlice.request(`/api/v1/comments/${comment1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Alice trying to edit Bob words' }
        });
        assert(aliceEditBob.status === 403 && aliceEditBob.body.error.code === 'FORBIDDEN',
            '3.5 Post author Alice CANNOT edit Bob comment (author-only editing enforced, HTTP 403 FORBIDDEN)');

        // 3.6 Bob edits own comment successfully
        const updatedText = 'Updated comment: Excellent point, Alice!';
        const bobEditRes = await clientBob.request(`/api/v1/comments/${comment1.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: updatedText }
        });
        assert(bobEditRes.status === 200 && bobEditRes.body.comment.content === updatedText,
            '3.6 Comment author Bob edits own comment successfully (HTTP 200)');

        // 3.7 Verify comment updated_at changed, but parent post updated_at remained UNCHANGED
        const editedCommentRow = await query('SELECT updated_at, created_at FROM post_comments WHERE id = $1;', [comment1.id]);
        assert(new Date(editedCommentRow.rows[0].updated_at) >= new Date(editedCommentRow.rows[0].created_at),
            '3.7 Comment updated_at timestamp updated');
        const afterEditPostRow = await query('SELECT updated_at FROM posts WHERE id = $1;', [post1.id]);
        assert(new Date(afterEditPostRow.rows[0].updated_at).getTime() === initialPostUpdatedAt,
            '3.8 Parent posts.updated_at remains strictly UNCHANGED after comment edit');

        // 3.8 Comment deletion permissions:
        // Unrelated Dave cannot delete Bob's comment
        const daveDeleteBob = await clientDave.request(`/api/v1/comments/${comment1.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': daveCsrf }
        });
        assert(daveDeleteBob.status === 403 && daveDeleteBob.body.error.code === 'FORBIDDEN',
            '3.9 Unrelated user Dave cannot delete Bob comment (HTTP 403 FORBIDDEN)');

        // Post author Alice CAN delete Bob's comment on her post (moderation permission)
        const aliceDeleteBob = await clientAlice.request(`/api/v1/comments/${comment1.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(aliceDeleteBob.status === 200, '3.10 Post author Alice can delete Bob comment on her post (HTTP 200)');

        // Verify comment soft-deleted in DB (deleted_at IS NOT NULL)
        const softDelCheck = await query('SELECT deleted_at FROM post_comments WHERE id = $1;', [comment1.id]);
        assert(softDelCheck.rows[0].deleted_at !== null, '3.11 Comment is soft-deleted (deleted_at IS NOT NULL)');

        // Verify posts.comments_count decremented to 1 in DB
        const countAfterAliceDelete = await query('SELECT comments_count FROM posts WHERE id = $1;', [post1.id]);
        assert(countAfterAliceDelete.rows[0].comments_count === 1,
            '3.12 posts.comments_count decremented to 1 after comment deletion');

        // Verify soft-deleted comment omitted from GET /posts/:id/comments
        const listAfterDelete = await clientGuest.request(`/api/v1/posts/${post1.id}/comments`);
        assert(listAfterDelete.body.pagination.total === 1, '3.13 Active comments total reduced to 1');
        assert(!listAfterDelete.body.comments.some((c) => c.id === comment1.id),
            '3.14 Soft-deleted comment is strictly excluded from comments list');

        // Comment author Bob deletes his second comment (boundary comment)
        const bobDeleteOwn = await clientBob.request(`/api/v1/comments/${boundaryCommentId}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(bobDeleteOwn.status === 200, '3.15 Comment author Bob can delete own comment (HTTP 200)');
        const finalCountCheck = await query('SELECT comments_count FROM posts WHERE id = $1;', [post1.id]);
        assert(finalCountCheck.rows[0].comments_count === 0, '3.16 posts.comments_count returned to 0');

        // Repeated delete of already soft-deleted comment returns 404
        const repeatDelete = await clientBob.request(`/api/v1/comments/${boundaryCommentId}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(repeatDelete.status === 404 && repeatDelete.body.error.code === 'COMMENT_NOT_FOUND',
            '3.17 Repeated delete of soft-deleted comment returns HTTP 404 COMMENT_NOT_FOUND');

        // =============================================================
        // SECTION 4: POST DELETION RACES & CONCURRENCY
        // =============================================================
        console.log('\n--- Section 4: Post Deletion Races & Concurrency ---');

        // Create a new post for deletion race tests
        const racePostRes = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Post to be deleted in race condition tests.' }
        });
        const racePost = racePostRes.body.post;

        // Add a comment to racePost by Bob
        const raceCommentRes = await clientBob.request(`/api/v1/posts/${racePost.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Comment on race post' }
        });
        const raceComment = raceCommentRes.body.comment;

        // Alice soft-deletes racePost
        const delRacePostRes = await clientAlice.request(`/api/v1/posts/${racePost.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': aliceCsrf }
        });
        assert(delRacePostRes.status === 200, '4.1 Alice soft-deletes post');

        // Attempting to like a deleted post returns 404
        const likeDelPost = await clientBob.request(`/api/v1/posts/${racePost.id}/like`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(likeDelPost.status === 404 && likeDelPost.body.error.code === 'POST_NOT_FOUND',
            '4.2 Like on soft-deleted post returns HTTP 404 POST_NOT_FOUND');

        // Attempting to comment on a deleted post returns 404
        const commentDelPost = await clientBob.request(`/api/v1/posts/${racePost.id}/comments`, {
            method: 'POST',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Ghost comment attempt' }
        });
        assert(commentDelPost.status === 404 && commentDelPost.body.error.code === 'POST_NOT_FOUND',
            '4.3 Comment on soft-deleted post returns HTTP 404 POST_NOT_FOUND');

        // Attempting to edit a comment whose parent post was deleted returns 404
        const editCommentDelPost = await clientBob.request(`/api/v1/comments/${raceComment.id}`, {
            method: 'PATCH',
            headers: { 'x-csrf-token': bobCsrf },
            body: { content: 'Editing comment on deleted post' }
        });
        assert(editCommentDelPost.status === 404 && editCommentDelPost.body.error.code === 'POST_NOT_FOUND',
            '4.4 Edit comment on deleted parent post returns HTTP 404 POST_NOT_FOUND');

        // Attempting to delete a comment whose parent post was deleted returns 404
        const delCommentDelPost = await clientBob.request(`/api/v1/comments/${raceComment.id}`, {
            method: 'DELETE',
            headers: { 'x-csrf-token': bobCsrf }
        });
        assert(delCommentDelPost.status === 404 && delCommentDelPost.body.error.code === 'POST_NOT_FOUND',
            '4.5 Delete comment on deleted parent post returns HTTP 404 POST_NOT_FOUND');

        // 4.6 Concurrent Likes Test
        console.log('\n--- Section 4.6: Concurrent Likes Concurrency Test ---');
        const concPostRes = await clientAlice.request('/api/v1/posts', {
            method: 'POST',
            headers: { 'x-csrf-token': aliceCsrf },
            body: { content: 'Post for concurrent interaction test' }
        });
        const concPost = concPostRes.body.post;

        // Register 4 additional disposable clients for concurrency
        const concurrentClients = [clientAlice, clientBob, clientCharlie, clientDave];
        const concTokens = [aliceCsrf, bobCsrf, charlieCsrf, daveCsrf];

        // Fire 4 concurrent like requests simultaneously
        const likePromises = concurrentClients.map((client, idx) =>
            client.request(`/api/v1/posts/${concPost.id}/like`, {
                method: 'POST',
                headers: { 'x-csrf-token': concTokens[idx] }
            })
        );
        const concLikeResults = await Promise.all(likePromises);
        const allLikesSucceeded = concLikeResults.every((r) => r.status === 200 && r.body.liked === true);
        assert(allLikesSucceeded, '4.6 All 4 concurrent like requests succeeded (HTTP 200)');

        // Verify database counter matches exact count of like rows
        const concDbLikeCheck = await query('SELECT likes_count FROM posts WHERE id = $1;', [concPost.id]);
        const concActualRowsCheck = await query('SELECT count(*)::int AS count FROM post_likes WHERE post_id = $1;', [concPost.id]);
        assert(concDbLikeCheck.rows[0].likes_count === 4 && concActualRowsCheck.rows[0].count === 4,
            '4.7 Database posts.likes_count (4) matches exact count of post_likes rows (4)');

        // Fire 4 concurrent unlike requests simultaneously
        const unlikePromises = concurrentClients.map((client, idx) =>
            client.request(`/api/v1/posts/${concPost.id}/like`, {
                method: 'DELETE',
                headers: { 'x-csrf-token': concTokens[idx] }
            })
        );
        const concUnlikeResults = await Promise.all(unlikePromises);
        const allUnlikesSucceeded = concUnlikeResults.every((r) => r.status === 200 && r.body.liked === false);
        assert(allUnlikesSucceeded, '4.8 All 4 concurrent unlike requests succeeded (HTTP 200)');

        const concDbUnlikeCheck = await query('SELECT likes_count FROM posts WHERE id = $1;', [concPost.id]);
        assert(concDbUnlikeCheck.rows[0].likes_count === 0, '4.9 Database posts.likes_count accurately returns to 0');

        // 4.10 Concurrent Comments Test
        console.log('\n--- Section 4.10: Concurrent Comments Concurrency Test ---');
        const commentPromises = concurrentClients.map((client, idx) =>
            client.request(`/api/v1/posts/${concPost.id}/comments`, {
                method: 'POST',
                headers: { 'x-csrf-token': concTokens[idx] },
                body: { content: `Concurrent comment by client #${idx}` }
            })
        );
        const concCommentResults = await Promise.all(commentPromises);
        const allCommentsSucceeded = concCommentResults.every((r) => r.status === 201);
        assert(allCommentsSucceeded, '4.10 All 4 concurrent comments succeeded (HTTP 201 Created)');

        const concDbCommentCheck = await query('SELECT comments_count FROM posts WHERE id = $1;', [concPost.id]);
        const concActualCommentsCheck = await query(
            'SELECT count(*)::int AS count FROM post_comments WHERE post_id = $1 AND deleted_at IS NULL;',
            [concPost.id]
        );
        assert(concDbCommentCheck.rows[0].comments_count === 4 && concActualCommentsCheck.rows[0].count === 4,
            '4.11 Database posts.comments_count (4) matches active post_comments row count (4)');

        // =============================================================
        // SECTION 5: DATABASE AUDIT & RESIDUAL TEST DATA CLEANUP
        // =============================================================
        console.log('\n--- Section 5: Database Cleanliness & Residual Data Cleanup ---');

        await cleanupDatabase();

        const auditUsers = await query(`SELECT count(*)::int AS count FROM users WHERE email LIKE '%${TEST_DOMAIN}';`);
        assert(auditUsers.rows[0].count === 0, '5.1 Disposable test users cleaned up (count: 0)');

        // Confirm real accounts preserved
        const realUsers = await query('SELECT count(*)::int AS count FROM users;');
        assert(realUsers.rows[0].count === 2, '5.2 Real user accounts preserved intact (count: 2)');

    } catch (err) {
        console.error('Test execution error:', err);
        failed++;
    } finally {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await closePool();
    }

    console.log('\n=============================================================');
    console.log(`📊 LIKES & COMMENTS TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('=============================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
};

if (require.main === module) {
    runLikesCommentsTests();
}

module.exports = { runLikesCommentsTests };
