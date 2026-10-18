import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Create mock Redis client functions
const mockUpstashGet = jest.fn<any>();
const mockUpstashSet = jest.fn<any>();
const mockUpstashDel = jest.fn<any>();
const mockUpstashScan = jest.fn<any>();

const mockConfig = {
    features: {
        useRedisCache: true,
    },
    redis: {
        url: 'https://test-redis.upstash.io',
        token: 'test-token',
        ioRedisUrl: '',
    },
    env: 'test',
};

// Mock dependencies
jest.unstable_mockModule('@upstash/redis', () => ({
    Redis: jest.fn().mockImplementation(() => ({
        get: mockUpstashGet,
        set: mockUpstashSet,
        del: mockUpstashDel,
        scan: mockUpstashScan,
    })),
}));

jest.unstable_mockModule('../../src/config/index.js', () => ({
    default: mockConfig,
}));

// Import modules under test after mocking
const { cacheService, cacheKeys } = await import('../../src/config/redis.js');

describe('CacheService Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockConfig.features.useRedisCache = true;
    });

    describe('cacheService.get', () => {
        it('should return null when feature flag useRedisCache is disabled', async () => {
            mockConfig.features.useRedisCache = false;
            const result = await cacheService.get('test-key');
            expect(result).toBeNull();
            expect(mockUpstashGet).not.toHaveBeenCalled();
        });

        it('should return data on a cache hit with JSON object', async () => {
            const cachedObject = { pageSlug: 'commons', memberCount: 42 };
            mockUpstashGet.mockResolvedValueOnce(JSON.stringify(cachedObject));

            const result = await cacheService.get('page:commons');
            expect(mockUpstashGet).toHaveBeenCalledWith('page:commons');
            expect(result).toEqual(cachedObject);
        });

        it('should return parsed object if Upstash returns parsed object directly', async () => {
            const cachedObject = { pageSlug: 'commons', memberCount: 42 };
            mockUpstashGet.mockResolvedValueOnce(cachedObject);

            const result = await cacheService.get('page:commons');
            expect(result).toEqual(cachedObject);
        });

        it('should return null on a cache miss', async () => {
            mockUpstashGet.mockResolvedValueOnce(null);

            const result = await cacheService.get('missing-key');
            expect(mockUpstashGet).toHaveBeenCalledWith('missing-key');
            expect(result).toBeNull();
        });

        it('should gracefully fall back and return null on Redis failure / quota exceeded without throwing', async () => {
            mockUpstashGet.mockRejectedValueOnce(new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500004'));

            const result = await cacheService.get('page:commons');
            expect(result).toBeNull();
        });
    });

    describe('cacheService.set', () => {
        it('should not call Redis when useRedisCache is disabled', async () => {
            mockConfig.features.useRedisCache = false;
            await cacheService.set('test-key', { foo: 'bar' }, 120);
            expect(mockUpstashSet).not.toHaveBeenCalled();
        });

        it('should store data serialized with specified TTL', async () => {
            mockUpstashSet.mockResolvedValueOnce('OK');
            const data = { pageSlug: 'commons', postCount: 5 };

            await cacheService.set('page:commons', data, 300);
            expect(mockUpstashSet).toHaveBeenCalledWith(
                'page:commons',
                JSON.stringify(data),
                { ex: 300 }
            );
        });

        it('should use default TTL (300s) when omitted', async () => {
            mockUpstashSet.mockResolvedValueOnce('OK');
            const data = { title: 'Test' };

            await cacheService.set('test-key', data);
            expect(mockUpstashSet).toHaveBeenCalledWith(
                'test-key',
                JSON.stringify(data),
                { ex: 300 }
            );
        });

        it('should catch Redis errors gracefully and not throw', async () => {
            mockUpstashSet.mockRejectedValueOnce(new Error('ERR max requests limit exceeded'));

            await expect(cacheService.set('test-key', { data: 1 })).resolves.not.toThrow();
        });
    });

    describe('cacheService.del', () => {
        it('should delete a key from Redis', async () => {
            mockUpstashDel.mockResolvedValueOnce(1);

            await cacheService.del('page:commons');
            expect(mockUpstashDel).toHaveBeenCalledWith('page:commons');
        });

        it('should catch Redis errors gracefully without throwing', async () => {
            mockUpstashDel.mockRejectedValueOnce(new Error('Connection timed out'));

            await expect(cacheService.del('page:commons')).resolves.not.toThrow();
        });
    });

    describe('cacheService.invalidatePattern', () => {
        it('should scan and delete all matching keys', async () => {
            mockUpstashScan
                .mockResolvedValueOnce([10, ['feed:commons:all:10', 'feed:commons:video:10']])
                .mockResolvedValueOnce([0, ['feed:commons:all:20']]);
            mockUpstashDel.mockResolvedValue(1);

            await cacheService.invalidatePattern('feed:commons:*');

            expect(mockUpstashScan).toHaveBeenCalledTimes(2);
            expect(mockUpstashDel).toHaveBeenCalledWith('feed:commons:all:10', 'feed:commons:video:10');
            expect(mockUpstashDel).toHaveBeenCalledWith('feed:commons:all:20');
        });

        it('should handle zero matching keys without error', async () => {
            mockUpstashScan.mockResolvedValueOnce([0, []]);

            await cacheService.invalidatePattern('feed:empty:*');
            expect(mockUpstashScan).toHaveBeenCalledTimes(1);
            expect(mockUpstashDel).not.toHaveBeenCalled();
        });

        it('should catch Redis scan errors gracefully', async () => {
            mockUpstashScan.mockRejectedValueOnce(new Error('Redis cluster down'));

            await expect(cacheService.invalidatePattern('feed:*')).resolves.not.toThrow();
        });
    });

    describe('cacheKeys helper', () => {
        it('should format creatorPage key with lowercased slug', () => {
            expect(cacheKeys.creatorPage('Commons')).toMatch(/page:commons$/);
        });

        it('should format creatorFeed key with type and limit', () => {
            expect(cacheKeys.creatorFeed('Commons', 'video', 20)).toMatch(/feed:commons:video:20$/);
        });

        it('should format creatorFeed with defaults', () => {
            expect(cacheKeys.creatorFeed('Commons')).toMatch(/feed:commons:all:10$/);
        });

        it('should format creatorFeedPattern correctly', () => {
            expect(cacheKeys.creatorFeedPattern('Commons')).toMatch(/feed:commons:\*$/);
        });

        it('should format creatorTiers key with creatorId', () => {
            const creatorId = '662b1a8c9f1e4a3b8c2d1e0f';
            expect(cacheKeys.creatorTiers(creatorId)).toMatch(new RegExp(`tiers:${creatorId}$`));
        });
    });
});
