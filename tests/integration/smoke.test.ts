import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Register ESM Mocks BEFORE any application modules are evaluated
// ─────────────────────────────────────────────────────────────────────────────

jest.unstable_mockModule('../../src/config/index.js', () => ({
    default: {
        env: 'test',
        port: 5001,
        clientUrl: 'http://localhost:3000',
        mongodb: {
            uri: 'mongodb://localhost:27017/test',
        },
        jwt: {
            accessSecret: 'test-smoke-access-secret',
            refreshSecret: 'test-smoke-refresh-secret',
            accessExpiry: '15m',
            refreshExpiry: '7d',
        },
        cookie: {
            secret: 'test-smoke-cookie-secret',
        },
        redis: {
            url: '',
            token: '',
            ioRedisUrl: undefined,
        },
        features: {
            useRedisCache: false,
            useBackgroundJobs: false,
            enableAuditLogs: false,
            emailEnabled: false,
        },
        mux: {
            tokenId: 'mock-mux-token-id',
            tokenSecret: 'mock-mux-token-secret',
            webhookSecret: 'mock-mux-webhook-secret',
        },
        cloudinary: {
            cloudName: 'mock-cloud-name',
            apiKey: 'mock-api-key',
            apiSecret: 'mock-api-secret',
        },
        google: {
            clientId: 'mock-google-client-id',
            clientSecret: 'mock-google-client-secret',
            callbackUrl: 'http://localhost:5001/auth/google/callback',
        },
        upload: {
            dir: 'uploads',
            maxFileSize: 10485760,
        },
    },
}));

// Mock external payment gateway to ensure tests never hit Safepay APIs
jest.unstable_mockModule('../../src/services/safepayService.js', () => ({
    getOrCreateSafepayCustomer: jest.fn(async () => 'mock-customer-token'),
    createTracker: jest.fn(async () => ({ token: 'mock-tracker-token-123' })),
    getAuthToken: jest.fn(async () => 'mock-auth-token'),
    createSafepayPlan: jest.fn(async () => ({ data: { plan_id: 'mock-plan-id' }, token: 'mock-plan-token' })),
    getSafepayTrackerStatus: jest.fn(async () => ({ data: { state: 'TRACKER_ENDED' } })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dynamic Imports so mocked modules take effect across all imported routes
// ─────────────────────────────────────────────────────────────────────────────

const { default: request } = await import('supertest');
const { Types } = await import('mongoose');
const { createTestApp } = await import('../utils/testApp.js');
const { connect, closeDatabase, clearDatabase } = await import('../utils/db.js');
const { default: User } = await import('../../src/models/User.js');
const { default: CreatorPage } = await import('../../src/models/CreatorPage.js');
const { default: Post } = await import('../../src/models/Post.js');
const { default: Tier } = await import('../../src/models/Tier.js');
const { default: Member } = await import('../../src/models/Member.js');
const { default: Comment } = await import('../../src/models/Comment.js');
const { default: PostLike } = await import('../../src/models/PostLike.js');
const { default: Subscription } = await import('../../src/models/Subscription.js');

const app = createTestApp();

describe('Stage 1 Functional Smoke Tests', () => {
    beforeAll(async () => {
        await connect();
    });

    afterAll(async () => {
        await closeDatabase();
    });

    beforeEach(async () => {
        await clearDatabase();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Test Helpers
    // ─────────────────────────────────────────────────────────────────────────

    const createSession = async (role: 'creator' | 'member', prefix: string) => {
        const signupData = {
            email: `${prefix}-${role}@example.com`,
            password: 'Password123!',
            displayName: `${prefix} ${role}`,
            username: `${prefix}_${role}`.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
            role,
        };

        const res = await request(app)
            .post('/auth/signup')
            .send(signupData)
            .expect(201);

        const cookies = Array.isArray(res.headers['set-cookie'])
            ? res.headers['set-cookie']
            : res.headers['set-cookie']
                ? [res.headers['set-cookie']]
                : [];

        return {
            user: res.body.data.user,
            cookies,
            signupData,
        };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Public Pages & Data-Fetching APIs
    // ─────────────────────────────────────────────────────────────────────────
    describe('1. Public Pages & System Data-Fetching Endpoints', () => {
        it('GET /health returns 200 and valid status payload', async () => {
            const res = await request(app)
                .get('/health')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.status).toBe('ok');
            expect(res.body.data.version).toBe('1.0.0');
            expect(res.body.data.timestamp).toBeDefined();
        });

        it('GET /home returns 200 server online status', async () => {
            const res = await request(app)
                .get('/home')
                .expect(200);

            expect(res.body.message).toBe('Server is online!');
        });

        it('GET /pages returns 200 and list of public published creators', async () => {
            // Seed a published creator page
            const { user } = await createSession('creator', 'pubpage');
            await CreatorPage.findOneAndUpdate(
                { userId: user._id },
                { isPublic: true, status: 'published', tagline: 'Welcome to my creative space' }
            );

            const res = await request(app)
                .get('/pages')
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.pages)).toBe(true);
            const found = res.body.data.pages.find((p: any) => p.pageSlug === user.username);
            expect(found).toBeDefined();
            expect(found.tagline).toBe('Welcome to my creative space');
        });

        it('GET /pages/:slug returns 200 for existing creator and 404 for missing creator', async () => {
            const { user } = await createSession('creator', 'slugtest');

            // Existing slug
            const resValid = await request(app)
                .get(`/pages/${user.username}`)
                .expect(200);

            expect(resValid.body.success).toBe(true);
            expect(resValid.body.data.page.pageSlug).toBe(user.username);

            // Non-existent slug
            const resInvalid = await request(app)
                .get('/pages/non-existent-slug-xyz')
                .expect(404);

            expect(resInvalid.body.success).toBe(false);
            expect(resInvalid.body.error.code).toBe('NOT_FOUND');
        });

        it('GET /posts/recent-videos returns 200 array of video posts for a creator slug', async () => {
            const { user } = await createSession('creator', 'vidcreator');

            const res = await request(app)
                .get(`/posts/recent-videos?pageSlug=${user.username}`)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data.posts)).toBe(true);
        });

        it('GET on unknown route returns 404 NOT_FOUND response', async () => {
            const res = await request(app)
                .get('/completely-unknown-route')
                .expect(404);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Authentication & Authenticated API Requests
    // ─────────────────────────────────────────────────────────────────────────
    describe('2. Authentication & Session Verification', () => {
        it('GET /auth/me fails with 401 UNAUTHORIZED when no cookies are provided', async () => {
            const res = await request(app)
                .get('/auth/me')
                .expect(401);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('UNAUTHORIZED');
        });

        it('GET /auth/me returns 200 and sanitized user profile with valid cookies', async () => {
            const { user, cookies } = await createSession('member', 'meauth');

            const res = await request(app)
                .get('/auth/me')
                .set('Cookie', cookies)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.user._id).toBe(user._id);
            expect(res.body.data.user.email).toBe(user.email);
            expect(res.body.data.user.passwordHash).toBeUndefined();
        });

        it('POST /auth/login returns 200 with correct credentials and 401 with wrong password', async () => {
            const { signupData } = await createSession('member', 'logintest');

            // Valid login
            const resSuccess = await request(app)
                .post('/auth/login')
                .send({
                    email: signupData.email,
                    password: signupData.password,
                })
                .expect(200);

            expect(resSuccess.body.success).toBe(true);
            expect(resSuccess.headers['set-cookie']).toBeDefined();

            // Invalid password
            const resFail = await request(app)
                .post('/auth/login')
                .send({
                    email: signupData.email,
                    password: 'WrongPassword999!',
                })
                .expect(401);

            expect(resFail.body.success).toBe(false);
            expect(resFail.body.error.code).toBe('INVALID_CREDENTIALS');
        });

        it('POST /auth/logout clears auth cookies and revokes session', async () => {
            const { cookies } = await createSession('member', 'logouttest');

            const resLogout = await request(app)
                .post('/auth/logout')
                .set('Cookie', cookies)
                .expect(200);

            expect(resLogout.body.success).toBe(true);

            // Accessing /auth/me without cookies fails
            await request(app)
                .get('/auth/me')
                .expect(401);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Authorization & Protected Resources (Role Guards)
    // ─────────────────────────────────────────────────────────────────────────
    describe('3. Authorization & Role Access Controls', () => {
        it('Guest accessing creator-only routes returns 401 UNAUTHORIZED', async () => {
            await request(app).get('/pages/my/page').expect(401);
            await request(app).post('/posts').send({ caption: 'Test' }).expect(401);
            await request(app).get('/analytics/overview').expect(401);
        });

        it('Standard member accessing creator-only routes returns 403 FORBIDDEN', async () => {
            const { cookies } = await createSession('member', 'rolemember');

            // Member trying to fetch creator page dashboard
            const resPage = await request(app)
                .get('/pages/my/page')
                .set('Cookie', cookies)
                .expect(403);
            expect(resPage.body.error.code).toBe('FORBIDDEN');

            // Member trying to create post
            const resPost = await request(app)
                .post('/posts')
                .set('Cookie', cookies)
                .send({ caption: 'Illegal member post' })
                .expect(403);
            expect(resPost.body.error.code).toBe('FORBIDDEN');

            // Member trying to read creator analytics
            const resAnalytics = await request(app)
                .get('/analytics/overview')
                .set('Cookie', cookies)
                .expect(403);
            expect(resAnalytics.body.error.code).toBe('FORBIDDEN');
        });

        it('Creator accessing creator-only routes succeeds with 200 OK', async () => {
            const { cookies } = await createSession('creator', 'rolecreator');

            const resPage = await request(app)
                .get('/pages/my/page')
                .set('Cookie', cookies)
                .expect(200);

            expect(resPage.body.success).toBe(true);
            expect(resPage.body.data.page).toBeDefined();
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Input Validation & Error Responses
    // ─────────────────────────────────────────────────────────────────────────
    describe('4. Input Validation & Error Handling', () => {
        it('POST /auth/signup rejects invalid email with 400 VALIDATION_ERROR', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send({
                    email: 'not-an-email',
                    password: 'Password123!',
                    displayName: 'Invalid User',
                    username: 'bademailuser',
                    role: 'member',
                })
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toHaveProperty('email');
        });

        it('POST /auth/signup rejects weak password (<8 characters) with 400', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send({
                    email: 'weakpass@example.com',
                    password: 'short',
                    displayName: 'Weak User',
                    username: 'weakuser',
                    role: 'member',
                })
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toHaveProperty('password');
        });

        it('PUT /users/me rejects oversized bio with 400 VALIDATION_ERROR', async () => {
            const { cookies } = await createSession('member', 'valuser');

            const longBio = 'a'.repeat(501);
            const res = await request(app)
                .put('/users/me')
                .set('Cookie', cookies)
                .send({ bio: longBio })
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toHaveProperty('bio');
        });

        it('POST /posts rejects empty caption with 400 VALIDATION_ERROR', async () => {
            const { cookies } = await createSession('creator', 'valcreator');

            const res = await request(app)
                .post('/posts')
                .set('Cookie', cookies)
                .send({
                    caption: '',
                    visibility: 'public',
                    postType: 'text',
                })
                .expect(400);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(res.body.error.details).toHaveProperty('caption');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Database Reads & Writes (CRUD & Social Interactions)
    // ─────────────────────────────────────────────────────────────────────────
    describe('5. Database Reads, Writes & Social Interactions', () => {
        it('Creator updates profile via PUT /pages/my/page and persists to database', async () => {
            const { cookies, user } = await createSession('creator', 'pagecrud');

            const updatePayload = {
                displayName: 'Renamed Creator Space',
                tagline: 'Fresh creative insights daily',
                about: 'This is my expanded about section detailing my work.',
                status: 'published' as const,
            };

            const res = await request(app)
                .put('/pages/my/page')
                .set('Cookie', cookies)
                .send(updatePayload)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.page.displayName).toBe('Renamed Creator Space');
            expect(res.body.data.page.tagline).toBe('Fresh creative insights daily');

            // Verify in DB directly
            const dbPage = await CreatorPage.findOne({ userId: user._id });
            expect(dbPage).toBeTruthy();
            expect(dbPage!.displayName).toBe('Renamed Creator Space');
            expect(dbPage!.tagline).toBe('Fresh creative insights daily');
            expect(dbPage!.status).toBe('published');
        });

        it('Creator creates a public post via POST /posts and retrieves it via GET /posts/:id', async () => {
            const { cookies, user } = await createSession('creator', 'postcrud');

            const postPayload = {
                caption: 'Hello community, this is our milestone update!',
                visibility: 'public' as const,
                postType: 'text' as const,
                status: 'published' as const,
            };

            const createRes = await request(app)
                .post('/posts')
                .set('Cookie', cookies)
                .send(postPayload)
                .expect(201);

            expect(createRes.body.success).toBe(true);
            const createdPost = createRes.body.data.post;
            expect(createdPost._id).toBeDefined();
            expect(createdPost.caption).toBe(postPayload.caption);

            // Verify in MongoDB
            const dbPost = await Post.findById(createdPost._id);
            expect(dbPost).toBeTruthy();
            expect(dbPost!.creatorId.toString()).toBe(user._id);

            // Fetch via public GET /posts/:id
            const getRes = await request(app)
                .get(`/posts/${createdPost._id}`)
                .expect(200);

            expect(getRes.body.success).toBe(true);
            expect(getRes.body.data.post.caption).toBe(postPayload.caption);
            expect(getRes.body.data.post.isLocked).toBe(false);
        });

        it('GET /posts/:id returns 404 NOT_FOUND for non-existent ID', async () => {
            const fakeId = new Types.ObjectId().toString();
            const res = await request(app)
                .get(`/posts/${fakeId}`)
                .expect(404);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('NOT_FOUND');
        });

        it('Member likes and unlikes a post via POST /posts/:id/like', async () => {
            const { cookies: creatorCookies } = await createSession('creator', 'likecr');
            const { cookies: memberCookies, user: memberUser } = await createSession('member', 'likemb');

            // Create post
            const postRes = await request(app)
                .post('/posts')
                .set('Cookie', creatorCookies)
                .send({
                    caption: 'Like this post if you agree!',
                    visibility: 'public',
                    postType: 'text',
                    status: 'published',
                })
                .expect(201);

            const postId = postRes.body.data.post._id;

            // 1. Like post
            const likeRes = await request(app)
                .post(`/posts/${postId}/like`)
                .set('Cookie', memberCookies)
                .expect(200);

            expect(likeRes.body.success).toBe(true);
            expect(likeRes.body.data.liked).toBe(true);
            expect(likeRes.body.data.likeCount).toBe(1);

            // Verify Like document in DB
            const dbLike = await PostLike.findOne({ postId, userId: memberUser._id });
            expect(dbLike).toBeTruthy();

            // 2. Unlike post (toggle)
            const unlikeRes = await request(app)
                .post(`/posts/${postId}/like`)
                .set('Cookie', memberCookies)
                .expect(200);

            expect(unlikeRes.body.success).toBe(true);
            expect(unlikeRes.body.data.liked).toBe(false);
            expect(unlikeRes.body.data.likeCount).toBe(0);

            // Verify Like document deleted from DB
            const deletedLike = await PostLike.findOne({ postId, userId: memberUser._id });
            expect(deletedLike).toBeNull();
        });

        it('Member adds a comment via POST /posts/:id/comments and fetches comments', async () => {
            const { cookies: creatorCookies } = await createSession('creator', 'commcr');
            const { cookies: memberCookies, user: memberUser } = await createSession('member', 'commmb');

            // Create post
            const postRes = await request(app)
                .post('/posts')
                .set('Cookie', creatorCookies)
                .send({
                    caption: 'Comments welcome below!',
                    visibility: 'public',
                    postType: 'text',
                    status: 'published',
                })
                .expect(201);

            const postId = postRes.body.data.post._id;

            // Add comment
            const commentPayload = { content: 'This is a fantastic functional smoke test comment!' };
            const addRes = await request(app)
                .post(`/posts/${postId}/comments`)
                .set('Cookie', memberCookies)
                .send(commentPayload)
                .expect(201);

            expect(addRes.body.success).toBe(true);
            expect(addRes.body.data.comment.content).toBe(commentPayload.content);

            // Verify comment document in DB
            const dbComment = await Comment.findOne({ postId, authorId: memberUser._id });
            expect(dbComment).toBeTruthy();
            expect(dbComment!.content).toBe(commentPayload.content);

            // Fetch comments list
            const getCommentsRes = await request(app)
                .get(`/posts/${postId}/comments`)
                .expect(200);

            expect(getCommentsRes.body.success).toBe(true);
            expect(getCommentsRes.body.data.comments.length).toBeGreaterThanOrEqual(1);
            expect(getCommentsRes.body.data.comments[0].content).toBe(commentPayload.content);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Membership Access Control, Tier Gating & Checkout Initiation
    // ─────────────────────────────────────────────────────────────────────────
    describe('6. Membership Access Controls, Tier Gating & Checkout Initiation', () => {
        it('Creator creates a tier via POST /tiers and public can fetch via GET /tiers/creator/:id', async () => {
            const { cookies: creatorCookies, user: creatorUser } = await createSession('creator', 'tiercr');

            const tierPayload = {
                name: 'VIP Backer',
                price: 1500, // In PKR
                description: 'Full access to behind the scenes and priority chats',
                benefits: ['Exclusive posts', 'Discord role', 'Monthly Q&A'],
                status: 'published',
            };

            const createRes = await request(app)
                .post('/tiers')
                .set('Cookie', creatorCookies)
                .send(tierPayload)
                .expect(201);

            expect(createRes.body.success).toBe(true);
            expect(createRes.body.data.name).toBe('VIP Backer');
            expect(createRes.body.data.price).toBe(1500);

            // Verify in DB
            const dbTier = await Tier.findById(createRes.body.data._id);
            expect(dbTier).toBeTruthy();
            expect(dbTier!.creatorId.toString()).toBe(creatorUser._id);

            // Public fetching creator plans
            const getTiersRes = await request(app)
                .get(`/tiers/creator/${creatorUser._id}`)
                .expect(200);

            expect(getTiersRes.body.success).toBe(true);
            expect(getTiersRes.body.data.plans.length).toBeGreaterThanOrEqual(1);
            expect(getTiersRes.body.data.plans[0].name).toBe('VIP Backer');
        });

        it('Members-only post is locked for guests and non-members, but unlocked for creator and active members', async () => {
            const { cookies: creatorCookies, user: creatorUser } = await createSession('creator', 'gatingcr');
            const { cookies: nonMemberCookies } = await createSession('member', 'nonmember');
            const { cookies: memberCookies, user: memberUser } = await createSession('member', 'activemember');

            // Creator publishes members-only post
            const postPayload = {
                caption: 'TOP SECRET CONTENT: Only active paying subscribers can read this full disclosure!',
                visibility: 'members' as const,
                postType: 'text' as const,
                status: 'published' as const,
            };

            const createRes = await request(app)
                .post('/posts')
                .set('Cookie', creatorCookies)
                .send(postPayload)
                .expect(201);

            const postId = createRes.body.data.post._id;

            // 1. Unauthenticated guest fetches members-only post -> Locked
            const guestRes = await request(app)
                .get(`/posts/${postId}`)
                .expect(200);

            expect(guestRes.body.data.post.isLocked).toBe(true);
            expect(guestRes.body.data.post.caption).toBeNull();
            expect(guestRes.body.data.post.teaser).toBeDefined();

            // 2. Authenticated non-member fetches members-only post -> Locked
            const nonMemberRes = await request(app)
                .get(`/posts/${postId}`)
                .set('Cookie', nonMemberCookies)
                .expect(200);

            expect(nonMemberRes.body.data.post.isLocked).toBe(true);
            expect(nonMemberRes.body.data.post.caption).toBeNull();

            // 3. Creator fetches their own members-only post -> Unlocked
            const creatorRes = await request(app)
                .get(`/posts/${postId}`)
                .set('Cookie', creatorCookies)
                .expect(200);

            expect(creatorRes.body.data.post.isLocked).toBe(false);
            expect(creatorRes.body.data.post.caption).toBe(postPayload.caption);

            // 4. Seed active membership in DB for memberUser
            const creatorPage = await CreatorPage.findOne({ userId: creatorUser._id });
            await Member.create({
                memberId: memberUser._id,
                creatorId: creatorUser._id,
                pageId: creatorPage!._id,
                status: 'active',
                joinedAt: new Date(),
            });

            // Active member fetches members-only post -> Unlocked
            const activeMemberRes = await request(app)
                .get(`/posts/${postId}`)
                .set('Cookie', memberCookies)
                .expect(200);

            expect(activeMemberRes.body.data.post.isLocked).toBe(false);
            expect(activeMemberRes.body.data.post.caption).toBe(postPayload.caption);
        });

        it('POST /tiers/:tierId/subscribe enforces auth, checks tier validity, and initiates checkout with mocked gateway', async () => {
            const { cookies: creatorCookies, user: creatorUser } = await createSession('creator', 'subcr');
            const { cookies: memberCookies, user: memberUser } = await createSession('member', 'submb');

            // Create tier
            const tierRes = await request(app)
                .post('/tiers')
                .set('Cookie', creatorCookies)
                .send({
                    name: 'Checkout Tier',
                    price: 2000,
                    description: 'Full tier description for checkout testing',
                    status: 'published',
                })
                .expect(201);

            const tierId = tierRes.body.data._id;

            // 1. Unauthenticated request -> 401
            await request(app)
                .post(`/tiers/${tierId}/subscribe`)
                .send({ interval: 'MONTHLY' })
                .expect(401);

            // 2. Non-existent tier -> 404
            const randomTierId = new Types.ObjectId().toString();
            const notFoundRes = await request(app)
                .post(`/tiers/${randomTierId}/subscribe`)
                .set('Cookie', memberCookies)
                .send({ interval: 'MONTHLY' })
                .expect(404);
            expect(notFoundRes.body.error.code).toBe('NOT_FOUND');

            // 3. Valid checkout initiation
            const subscribeRes = await request(app)
                .post(`/tiers/${tierId}/subscribe`)
                .set('Cookie', memberCookies)
                .send({ interval: 'MONTHLY' })
                .expect(200);

            expect(subscribeRes.body.success).toBe(true);
            expect(subscribeRes.body.data.trackerToken).toBe('mock-tracker-token-123');
            expect(subscribeRes.body.data.authToken).toBe('mock-auth-token');

            // Verify pending subscription created in MongoDB
            const dbSub = await Subscription.findOne({
                userId: memberUser._id,
                planId: tierId,
                status: 'incomplete',
            });
            expect(dbSub).toBeTruthy();
            expect(dbSub!.safepaySubscriptionId).toBe('mock-tracker-token-123');
            expect(dbSub!.creatorId.toString()).toBe(creatorUser._id);
        });
    });
});
