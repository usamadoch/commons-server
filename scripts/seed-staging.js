/**
 * Seed Staging Database Script
 *
 * Populates the isolated staging environment (commons_staging) with synthetic creators,
 * members, posts, tiers, and interactions.
 *
 * Usage:
 *   node server/scripts/seed-staging.js [TARGET_URL]
 *
 * Example:
 *   node server/scripts/seed-staging.js https://commons-api-staging.onrender.com
 */

const targetUrl = (process.argv[2] || process.env.STAGING_API_URL || 'http://localhost:5000').replace(/\/$/, '');

// Safety check: NEVER seed production
const forbiddenHosts = ['api.commons.pk', 'www.commons.pk', 'commons.pk'];
const urlObj = new URL(targetUrl);

if (forbiddenHosts.includes(urlObj.hostname.toLowerCase())) {
    console.error(`\x1b[31m[CRITICAL ERROR] Refusing to seed production target: ${targetUrl}\x1b[0m`);
    process.exit(1);
}

console.log(`\n================================================================`);
console.log(`🌱 Seeding Isolated Staging Target: ${targetUrl}`);
console.log(`================================================================\n`);

async function run() {
    try {
        // 1. Health & Config check
        console.log(`1. Checking server health and database status...`);
        const healthRes = await fetch(`${targetUrl}/home`);
        if (!healthRes.ok) {
            throw new Error(`Server returned HTTP ${healthRes.status}: ${await healthRes.text()}`);
        }
        const healthData = await healthRes.json();
        console.log(`   - Server response: ${healthData.message}`);
        console.log(`   - Environment: ${healthData.env}`);
        console.log(`   - Database status: ${healthData.database?.status}`);

        // 2. Fetch CSRF Token
        console.log(`\n2. Fetching CSRF Token...`);
        const csrfRes = await fetch(`${targetUrl}/auth/csrf`);
        const csrfData = await csrfRes.json();
        const cookies = csrfRes.headers.get('set-cookie') || '';
        const csrfToken = csrfData.data?.csrfToken;

        if (!csrfToken) {
            console.warn(`   ⚠️ Warning: No CSRF token returned, proceeding without x-csrf-token`);
        } else {
            console.log(`   ✓ CSRF Token received`);
        }

        // 3. Trigger Seed
        console.log(`\n3. Sending POST /seed request...`);
        const seedRes = await fetch(`${targetUrl}/seed`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': csrfToken || '',
                'Cookie': cookies,
            },
        });

        const seedJson = await seedRes.json();

        if (!seedRes.ok) {
            console.error(`\x1b[31m   ❌ Seeding failed (HTTP ${seedRes.status}):\x1b[0m`, seedJson);
            process.exit(1);
        }

        console.log(`   \x1b[32m✓ Seeding successful!\x1b[0m`);
        console.log(`   - Creators seeded: ${seedJson.data?.creators}`);
        console.log(`   - Members seeded:  ${seedJson.data?.members}`);
        console.log(`   - Posts seeded:    ${seedJson.data?.posts}`);
        console.log(`   - Comments seeded: ${seedJson.data?.comments}`);
        console.log(`   - Likes seeded:    ${seedJson.data?.likes}`);
        console.log(`   - Conversations:   ${seedJson.data?.conversations}`);

        // 4. Verify seeded creator page
        console.log(`\n4. Verifying synthetic creator page retrieval...`);
        const pageRes = await fetch(`${targetUrl}/pages/alice-creative`);
        if (pageRes.ok) {
            const pageJson = await pageRes.json();
            console.log(`   ✓ Creator page accessible: "${pageJson.data?.displayName}" (@${pageJson.data?.pageSlug})`);
        } else {
            console.warn(`   ⚠️ Creator page check returned HTTP ${pageRes.status}`);
        }

        console.log(`\n================================================================`);
        console.log(`✅ Staging Database is populated and ready for test validation!`);
        console.log(`================================================================\n`);
    } catch (err) {
        console.error(`\x1b[31m[ERROR] ${err.message}\x1b[0m`);
        process.exit(1);
    }
}

run();
