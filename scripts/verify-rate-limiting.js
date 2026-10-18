/**
 * Rate Limiting Verification Script
 *
 * Specifically verifies that rate limiting functions correctly by sending
 * a burst of requests to trigger HTTP 429 Too Many Requests on demand,
 * separating rate-limiter validation from 20-VU backend capacity testing.
 *
 * Usage:
 *   node server/scripts/verify-rate-limiting.js [TARGET_URL] [BURST_COUNT]
 *
 * Example:
 *   node server/scripts/verify-rate-limiting.js http://localhost:5000 110
 */

const targetUrl = (process.argv[2] || process.env.API_URL || 'http://localhost:5000').replace(/\/$/, '');
const burstCount = parseInt(process.argv[3] || '110', 10);

console.log(`\n================================================================`);
console.log(`🛡️ Rate Limiting Threshold Verification`);
console.log(`   Target: ${targetUrl}`);
console.log(`   Burst Request Count: ${burstCount}`);
console.log(`================================================================\n`);

async function run() {
    let okCount = 0;
    let rateLimitedCount = 0;
    let otherCount = 0;
    let first429Index = null;
    let rateLimitHeadersCaptured = null;

    console.log(`Sending ${burstCount} sequential requests to test rate limiter enforcement...\n`);

    for (let i = 1; i <= burstCount; i++) {
        try {
            const res = await fetch(`${targetUrl}/health`); // /health is excluded from rate limiting, let's use an API route
            // To test apiLimiter, we need a route mounted under apiLimiter, e.g., /pages
            const apiRes = await fetch(`${targetUrl}/pages`);
            
            if (apiRes.status === 200) {
                okCount++;
            } else if (apiRes.status === 429) {
                rateLimitedCount++;
                if (first429Index === null) {
                    first429Index = i;
                    rateLimitHeadersCaptured = {
                        limit: apiRes.headers.get('ratelimit-limit') || apiRes.headers.get('x-ratelimit-limit'),
                        remaining: apiRes.headers.get('ratelimit-remaining') || apiRes.headers.get('x-ratelimit-remaining'),
                        retryAfter: apiRes.headers.get('retry-after'),
                    };
                }
            } else {
                otherCount++;
            }
        } catch (err) {
            otherCount++;
        }

        if (i % 25 === 0 || i === burstCount) {
            process.stdout.write(`   Sent ${i}/${burstCount} requests... (OK: ${okCount}, 429: ${rateLimitedCount})\n`);
        }
    }

    console.log(`\n----------------------------------------------------------------`);
    console.log(`📊 Verification Results:`);
    console.log(`   Total Sent:           ${burstCount}`);
    console.log(`   200 OK Responses:     ${okCount}`);
    console.log(`   429 Rate Limited:     ${rateLimitedCount}`);
    console.log(`   Other/Errors:         ${otherCount}`);

    if (first429Index !== null) {
        console.log(`\n   \x1b[32m✓ Rate limiting successfully triggered on request #${first429Index}!\x1b[0m`);
        console.log(`   RateLimit Headers:`, rateLimitHeadersCaptured);
    } else {
        console.log(`\n   \x1b[33mℹ️ No 429 responses triggered. (If running in staging profile with max=3000, 110 requests will not exceed the staging limit).\x1b[0m`);
    }
    console.log(`================================================================\n`);
}

run();
