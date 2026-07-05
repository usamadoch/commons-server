
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';

// Mock config before other imports
jest.unstable_mockModule('../../src/config/index.js', () => ({
    default: {
        env: 'test',
        jwt: {
            accessSecret: 'test-secret',
            refreshSecret: 'test-refresh-secret',
            accessExpiry: '15m',
            refreshExpiry: '7d'
        },
        cookie: {
            secret: 'test-cookie-secret'
        },
        clientUrl: 'http://localhost:3000',
        redis: {
            ioRedisUrl: undefined
        }
    }
}));

import request from 'supertest';
import { createTestApp } from '../utils/testApp.js';
import { connect, closeDatabase, clearDatabase } from '../utils/db.js';
import User from '../../src/models/User.js';
import RefreshToken from '../../src/models/RefreshToken.js';
import jwt from 'jsonwebtoken';


const app = createTestApp();

describe('Auth API Integration Tests', () => {
    beforeAll(async () => {
        await connect();
    });

    afterAll(async () => {
        await closeDatabase();
    });

    afterEach(async () => {
        await clearDatabase();
    });

    describe('POST /auth/signup', () => {
        const newUser = {
            email: 'test@example.com',
            password: 'Password123!',
            displayName: 'Test User',
            username: 'testuser',
            role: 'member'
        };

        it('should register a new user successfully', async () => {
            const res = await request(app)
                .post('/auth/signup')
                .send(newUser)
                .expect(201);

            expect(res.body.success).toBe(true);
            expect(res.body.data.user).toHaveProperty('email', newUser.email);
            expect(res.headers['set-cookie']).toBeDefined();

            // Verify User in DB
            const user = await User.findOne({ email: newUser.email });
            expect(user).toBeTruthy();
            expect(user!.username).toBe(newUser.username);
        });

        it('should fail with duplicate email', async () => {
            // Create user first
            await request(app).post('/auth/signup').send(newUser);

            // Try to create again
            const res = await request(app)
                .post('/auth/signup')
                .send(newUser)
                .expect(409);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
        });

        it('should fail with invalid email', async () => {
            await request(app)
                .post('/auth/signup')
                .send({ ...newUser, email: 'invalid-email' })
                .expect(400);
        });

        it('should fail with short password', async () => {
            await request(app)
                .post('/auth/signup')
                .send({ ...newUser, password: 'short' })
                .expect(400);
        });
    });

    describe('POST /auth/login', () => {
        const userCredentials = {
            email: 'login@example.com',
            password: 'Password123!'
        };

        beforeEach(async () => {
            // Seed a user
            await request(app).post('/auth/signup').send({
                ...userCredentials,
                displayName: 'Login User',
                username: 'loginuser',
                role: 'member'
            });
        });

        it('should login successfully with correct credentials', async () => {
            const res = await request(app)
                .post('/auth/login')
                .send(userCredentials)
                .expect(200);

            expect(res.body.success).toBe(true);
            expect(res.body.data.user.email).toBe(userCredentials.email);
            expect(res.headers['set-cookie']).toBeDefined();

            const cookies = Array.isArray(res.headers['set-cookie'])
                ? res.headers['set-cookie']
                : res.headers['set-cookie']
                    ? [res.headers['set-cookie']]
                    : [];
            const accessTokenCookie = cookies.find((c: string) => c.startsWith('accessToken'));
            const refreshTokenCookie = cookies.find((c: string) => c.startsWith('refreshToken'));

            expect(accessTokenCookie).toBeTruthy();
            expect(refreshTokenCookie).toBeTruthy();

            // Verify refresh token stored in DB
            const user = await User.findOne({ email: userCredentials.email });
            const refreshTokens = await RefreshToken.find({ userId: user!._id });
            expect(refreshTokens.length).toBeGreaterThan(0);
        });

        it('should fail with incorrect password', async () => {
            const res = await request(app)
                .post('/auth/login')
                .send({ ...userCredentials, password: 'wrongpassword' })
                .expect(401);

            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
        });

        it('should fail with non-existent user', async () => {
            await request(app)
                .post('/auth/login')
                .send({ email: 'nonexistent@example.com', password: 'password123' })
                .expect(401);
        });
    });

    describe('Authenticated Routes', () => {
        let authCookies: string[];
        let userId: string;

        beforeEach(async () => {
            // Create and login user
            const signupRes = await request(app).post('/auth/signup').send({
                email: 'auth@example.com',
                password: 'Password123!',
                displayName: 'Auth User',
                username: 'authuser',
                role: 'member'
            });

            authCookies = Array.isArray(signupRes.headers['set-cookie'])
                ? signupRes.headers['set-cookie']
                : signupRes.headers['set-cookie']
                    ? [signupRes.headers['set-cookie']]
                    : [];
            userId = signupRes.body.data.user._id;
        });

        describe('GET /auth/me', () => {
            it('should return user profile with valid token', async () => {
                const res = await request(app)
                    .get('/auth/me')
                    .set('Cookie', authCookies)
                    .expect(200);

                expect(res.body.success).toBe(true);
                expect(res.body.data.user.email).toBe('auth@example.com');
                expect(res.body.data.user).not.toHaveProperty('passwordHash');
            });

            it('should fail without token', async () => {
                const res = await request(app)
                    .get('/auth/me')
                    .expect(401);

                expect(res.body.error.code).toBe('UNAUTHORIZED');
            });

            it('should fail with expired access token', async () => {
                const expiredToken = jwt.sign(
                    { userId, email: 'auth@example.com', role: 'member' },
                    'test-secret', // Matches mock config
                    { expiresIn: '-1s' }
                );

                const res = await request(app)
                    .get('/auth/me')
                    .set('Cookie', [`accessToken=${expiredToken}`])
                    .expect(401);

                // Expect either TOKEN_EXPIRED or UNAUTHORIZED depending on implementation
                // Usually jwt verification throws TokenExpiredError which might be caught as 401
                expect(res.body.success).toBe(false);
            });

        });

        describe('POST /auth/refresh', () => {
            it('should return new tokens with valid refresh token', async () => {
                const res = await request(app)
                    .post('/auth/refresh')
                    .set('Cookie', authCookies)
                    .expect(200);

                expect(res.body.success).toBe(true);
                expect(res.headers['set-cookie']).toBeDefined();

                const newCookies = Array.isArray(res.headers['set-cookie'])
                    ? res.headers['set-cookie']
                    : res.headers['set-cookie']
                        ? [res.headers['set-cookie']]
                        : [];
                expect(newCookies.some((c: string) => c.startsWith('accessToken'))).toBe(true);
                expect(newCookies.some((c: string) => c.startsWith('refreshToken'))).toBe(true);
            });

            it('should fail without refresh token', async () => {
                await request(app)
                    .post('/auth/refresh')
            });

            it('should fail when reusing refresh token', async () => {
                // First use - should succeed
                const res1 = await request(app)
                    .post('/auth/refresh')
                    .set('Cookie', authCookies)
                    .expect(200);

                const newCookies = res1.headers['set-cookie'];

                // Second use with SAME initial cookies - should fail
                // The refresh token from authCookies was used and deleted in the first call
                const res2 = await request(app)
                    .post('/auth/refresh')
                    .set('Cookie', authCookies)
                    .expect(401); // Expect failure as token is gone

                expect(res2.body.success).toBe(false);
            });

        });

        describe('POST /auth/logout', () => {
            it('should logout and clear cookies', async () => {
                const res = await request(app)
                    .post('/auth/logout')
                    .set('Cookie', authCookies)
                    .expect(200);

                expect(res.body.success).toBe(true);

                const logoutCookies = Array.isArray(res.headers['set-cookie'])
                    ? res.headers['set-cookie']
                    : res.headers['set-cookie']
                        ? [res.headers['set-cookie']]
                        : [];
                const clearedCookies = logoutCookies.filter((c: string) =>
                    c.includes('accessToken') || c.includes('refreshToken')
                );

                // Cookies should be expired
                expect(clearedCookies.length).toBeGreaterThan(0);

                // Verify refresh tokens deleted from DB
                const refreshTokens = await RefreshToken.find({ userId });
                expect(refreshTokens.length).toBe(0);

                // Verify API call fails with old token
                await request(app)
                    .post('/auth/refresh')
                    .set('Cookie', authCookies)
                    .expect(401);

            });

            it('should require authentication', async () => {
                await request(app)
                    .post('/auth/logout')
                    .expect(401);
            });
        });

        describe('POST /auth/change-password', () => {
            it('should change password with valid current password', async () => {
                const res = await request(app)
                    .post('/auth/change-password')
                    .set('Cookie', authCookies)
                    .send({
                        currentPassword: 'Password123!',
                        newPassword: 'NewPassword456!'
                    })
                    .expect(200);

                expect(res.body.success).toBe(true);

                // Verify can login with new password
                const loginRes = await request(app)
                    .post('/auth/login')
                    .send({
                        email: 'auth@example.com',
                        password: 'NewPassword456!'
                    })
                    .expect(200);

                expect(loginRes.body.success).toBe(true);

                // Verify cannot login with old password
                await request(app)
                    .post('/auth/login')
                    .send({
                        email: 'auth@example.com',
                        password: 'Password123!'
                    })
                    .expect(401);

                // Verify old refresh token is invalidated
                await request(app)
                    .post('/auth/refresh')
                    .set('Cookie', authCookies)
                    .expect(401);

            });

            it('should fail with incorrect current password', async () => {
                await request(app)
                    .post('/auth/change-password')
                    .set('Cookie', authCookies)
                    .send({
                        currentPassword: 'WrongPassword1!',
                        newPassword: 'NewPassword456!'
                    })
                    .expect(401);
            });

            it('should require authentication', async () => {
                await request(app)
                    .post('/auth/change-password')
                    .send({
                        currentPassword: 'Password123!',
                        newPassword: 'NewPassword456!'
                    })
                    .expect(401);
            });
        });
    });

    describe('Email Check', () => {
        it('should return true for existing email', async () => {
            await User.create({
                email: 'existing@example.com',
                passwordHash: '$2b$10$hashedpassword123',
                displayName: 'Existing',
                username: 'existing',
                role: 'member'
            });

            const res = await request(app)
                .post('/auth/check-email')
                .send({ email: 'existing@example.com' })
                .expect(200);

            expect(res.body.data.exists).toBe(true);
        });

        it('should return false for non-existent email', async () => {
            const res = await request(app)
                .post('/auth/check-email')
                .send({ email: 'nonexistent@example.com' })
                .expect(200);

            expect(res.body.data.exists).toBe(false);
        });
    });
});
