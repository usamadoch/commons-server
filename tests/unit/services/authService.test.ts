import { jest } from '@jest/globals';

// Mock all dependencies BEFORE importing the service under test
jest.unstable_mockModule('../../../src/models/User.js', () => ({
    __esModule: true,
    default: {
        findOne: jest.fn(),
        findById: jest.fn(),
        create: jest.fn(),
        exists: jest.fn(),
    }
}));

jest.unstable_mockModule('../../../src/models/RefreshToken.js', () => ({
    __esModule: true,
    default: {
        create: jest.fn(),
        findOne: jest.fn(),
        deleteOne: jest.fn(),
        deleteMany: jest.fn(),
    }
}));

jest.unstable_mockModule('../../../src/models/CreatorPage.js', () => ({
    __esModule: true,
    default: {
        create: jest.fn(),
        findOne: jest.fn(),
    }
}));

jest.unstable_mockModule('jsonwebtoken', () => ({
    __esModule: true,
    default: {
        sign: jest.fn(),
        verify: jest.fn(),
    },
    sign: jest.fn(),
    verify: jest.fn(),
}));

// Dynamic import variables
let authService: typeof import('../../../src/services/authService.js');
let User: any; // Mongoose model - keeping as any for mock flexibility
let RefreshToken: any; // Mongoose model - keeping as any for mock flexibility
let CreatorPage: any; // Mongoose model - keeping as any for mock flexibility
let jwt: typeof import('jsonwebtoken');

describe('AuthService', () => {
    const mockUserId = 'user123';
    const mockEmail = 'test@example.com';
    const mockPassword = 'password123';
    const mockAccessToken = 'mock-access-token';
    const mockRefreshToken = 'mock-refresh-token';

    beforeAll(async () => {
        // Dynamic imports after mocks are set up
        const authServiceModule = await import('../../../src/services/authService.js');
        authService = authServiceModule;

        const userModule = await import('../../../src/models/User.js');
        User = userModule.default;

        const refreshTokenModule = await import('../../../src/models/RefreshToken.js');
        RefreshToken = refreshTokenModule.default;

        const creatorPageModule = await import('../../../src/models/CreatorPage.js');
        CreatorPage = creatorPageModule.default;

        const jwtModule = await import('jsonwebtoken');
        jwt = jwtModule;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (jwt.sign as jest.Mock).mockReturnValue(mockAccessToken);
    });

    describe('checkEmail', () => {
        it('should return true if email exists', async () => {
            User.exists.mockResolvedValue({ _id: mockUserId });

            const result = await authService.checkEmail(mockEmail);

            expect(result).toBe(true);
            expect(User.exists).toHaveBeenCalledWith({ email: mockEmail.toLowerCase() });
        });

        it('should return false if email does not exist', async () => {
            User.exists.mockResolvedValue(null);

            const result = await authService.checkEmail(mockEmail);

            expect(result).toBe(false);
            expect(User.exists).toHaveBeenCalledWith({ email: mockEmail.toLowerCase() });
        });
    });

    describe('signup', () => {
        const signupInput = {
            email: mockEmail,
            password: mockPassword,
            displayName: 'Test User',
            username: 'testuser',
            role: 'member' as const
        };

        it('should create a new user and return tokens', async () => {
            // Mock no existing user
            User.findOne.mockResolvedValue(null);

            // Mock user creation
            const mockUser: any = {
                _id: mockUserId,
                email: mockEmail,
                role: 'member',
                save: (jest.fn() as any).mockResolvedValue(true),
                toObject: (jest.fn() as any).mockReturnValue({ _id: mockUserId, email: mockEmail })
            };
            User.create.mockResolvedValue(mockUser);
            RefreshToken.create.mockResolvedValue({ token: mockRefreshToken });

            const result = await authService.signup(signupInput);

            expect(User.findOne).toHaveBeenCalledTimes(2); // Email and username check
            expect(User.create).toHaveBeenCalled();
            expect(result).toHaveProperty('tokens');
            expect(result.tokens).toHaveProperty('accessToken');
            expect(result.tokens).toHaveProperty('refreshToken');
            expect(result.isNewUser).toBe(true);
        });

        it('should throw error if email already exists', async () => {
            User.findOne.mockResolvedValueOnce({ _id: 'existing' });

            await expect(authService.signup(signupInput))
                .rejects.toThrow();
        });

        it('should throw error if username already exists', async () => {
            User.findOne
                .mockResolvedValueOnce(null) // Email check passes
                .mockResolvedValueOnce({ _id: 'existing' }); // Username check fails

            await expect(authService.signup(signupInput))
                .rejects.toThrow();
        });

        it('should create creator page if role is creator', async () => {
            User.findOne.mockResolvedValue(null);
            const mockUser: any = {
                _id: 'creator-id',
                email: 'creator@example.com',
                role: 'creator',
                save: (jest.fn() as any).mockResolvedValue(true),
                toObject: (jest.fn() as any).mockReturnValue({ _id: 'creator-id' })
            };
            User.create.mockResolvedValue(mockUser);
            RefreshToken.create.mockResolvedValue({ token: mockRefreshToken });

            await authService.signup({ ...signupInput, role: 'creator', username: 'creator' });

            expect(CreatorPage.create).toHaveBeenCalled();
        });
    });

    describe('login', () => {
        const loginInput = { email: mockEmail, password: mockPassword };

        it('should login successfully with correct credentials', async () => {
            const mockUser: any = {
                _id: mockUserId,
                email: mockEmail,
                isActive: true,
                comparePassword: (jest.fn() as any).mockResolvedValue(true),
                save: (jest.fn() as any).mockResolvedValue(true),
                toObject: (jest.fn() as any).mockReturnValue({ _id: mockUserId, email: mockEmail })
            };

            const mockQuery: any = { select: (jest.fn() as any).mockResolvedValue(mockUser) };
            User.findOne.mockReturnValue(mockQuery);
            RefreshToken.create.mockResolvedValue({ token: mockRefreshToken });

            const result = await authService.login(loginInput);

            expect(result.tokens).toHaveProperty('accessToken');
            expect(result.tokens).toHaveProperty('refreshToken');
            expect(mockUser.comparePassword).toHaveBeenCalledWith(mockPassword);
        });

        it('should throw error if user not found', async () => {
            const mockQuery: any = { select: (jest.fn() as any).mockResolvedValue(null) };
            User.findOne.mockReturnValue(mockQuery);

            await expect(authService.login(loginInput))
                .rejects.toThrow();
        });

        it('should throw error if password incorrect', async () => {
            const mockUser: any = {
                email: mockEmail,
                isActive: true,
                comparePassword: (jest.fn() as any).mockResolvedValue(false)
            };
            const mockQuery: any = { select: (jest.fn() as any).mockResolvedValue(mockUser) };
            User.findOne.mockReturnValue(mockQuery);

            await expect(authService.login(loginInput))
                .rejects.toThrow();
        });
    });

    describe('refreshAccessToken', () => {
        it('should return new tokens if refresh token is valid', async () => {
            const mockTokenDoc = {
                _id: 'token-id',
                userId: mockUserId,
                expiresAt: new Date(Date.now() + 100000)
            };
            RefreshToken.findOne.mockResolvedValue(mockTokenDoc);

            const mockUser = {
                _id: mockUserId,
                isActive: true,
                toObject: jest.fn().mockReturnValue({ _id: mockUserId })
            };
            User.findById.mockReturnValue({ select: jest.fn<any>().mockResolvedValue(mockUser) });
            RefreshToken.deleteOne.mockResolvedValue({});
            RefreshToken.create.mockResolvedValue({ token: 'new-refresh-token' });

            const result = await authService.refreshAccessToken(mockRefreshToken);

            expect(RefreshToken.deleteOne).toHaveBeenCalledWith({ _id: 'token-id' });
            expect(result).toHaveProperty('accessToken');
            expect(result).toHaveProperty('refreshToken');
        });

        it('should throw error if token not found', async () => {
            RefreshToken.findOne.mockResolvedValue(null);

            await expect(authService.refreshAccessToken('invalid-token'))
                .rejects.toThrow();
        });
    });

    describe('logout', () => {
        it('should delete refresh token on logout', async () => {
            RefreshToken.deleteOne.mockResolvedValue({});

            await authService.logout(mockUserId, mockRefreshToken);

            expect(RefreshToken.deleteOne).toHaveBeenCalledWith({
                userId: mockUserId,
                token: mockRefreshToken
            });
        });

        it('should delete all tokens if no specific token provided', async () => {
            RefreshToken.deleteMany.mockResolvedValue({});

            await authService.logout(mockUserId);

            expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ userId: mockUserId });
        });
    });

    describe('getCurrentUser', () => {
        it('should return sanitized user', async () => {
            const mockUser = {
                toObject: jest.fn().mockReturnValue({
                    _id: mockUserId,
                    email: mockEmail,
                    role: 'member',
                    displayName: 'Test User',
                    username: 'testuser',
                })
            };
            User.findById.mockReturnValue({ select: jest.fn<any>().mockResolvedValue(mockUser) });

            const result = await authService.getCurrentUser(mockUserId);

            expect(result).toBeTruthy();
            expect(result).not.toHaveProperty('passwordHash');
        });

        it('should return null if user not found', async () => {
            User.findById.mockReturnValue({ select: jest.fn<any>().mockResolvedValue(null) });

            const result = await authService.getCurrentUser(mockUserId);

            expect(result).toBe(null);
        });
    });
});
