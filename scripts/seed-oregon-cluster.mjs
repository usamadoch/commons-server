import fs from 'fs';
import dns from 'dns';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

dns.setServers(['8.8.8.8']);

const envProd = fs.readFileSync('c:/Users/d/Documents/commons/server/.env.prod', 'utf8');
const uriMatch = envProd.match(/^MONGODB_URI=(.*)$/m);
if (!uriMatch) {
    console.error('No MONGODB_URI found in .env.prod');
    process.exit(1);
}
const oregonUri = uriMatch[1].trim();

// Safety check: ensure we are targeting the Oregon cluster, not Mumbai or local dev
if (!oregonUri.includes('0hhveup')) {
    console.error('[SAFETY] Refusing to seed: MONGODB_URI in .env.prod does not match the Oregon cluster.');
    process.exit(1);
}

async function seedDb(targetDbName) {
    const uri = oregonUri.replace(/\/commons(\?|$)/, `/${targetDbName}$1`);
    console.log(`\nConnecting to Oregon database: ${targetDbName}...`);
    const conn = await mongoose.createConnection(uri).asPromise();
    const db = conn.db;

    const creatorUserId = new mongoose.Types.ObjectId('6a4ab792301861fbab5f22c8');
    const creatorPageId = new mongoose.Types.ObjectId('6a4ab794301861fbab5f22cb');
    const tierId = new mongoose.Types.ObjectId('6a6b59e2987cb5a57a940db8');
    const postId = new mongoose.Types.ObjectId('6ab670e11d78868df779cf94');
    const memberUserId = new mongoose.Types.ObjectId('6a4ab792301861fbab5f22c9');

    // 1. Seed Creator User
    const passwordHash = await bcrypt.hash('TestPassword123!', 10);
    await db.collection('users').updateOne(
        { _id: creatorUserId },
        {
            $set: {
                email: 'creator@commons.pk',
                passwordHash,
                role: 'creator',
                displayName: 'commons',
                username: 'commons',
                bio: 'Official Commons Creator Profile',
                isEmailVerified: true,
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
            }
        },
        { upsert: true }
    );
    console.log(`✓ [${targetDbName}] Seeded Creator User`);

    // 2. Seed Member User
    await db.collection('users').updateOne(
        { _id: memberUserId },
        {
            $set: {
                email: 'member@commons.pk',
                passwordHash,
                role: 'member',
                displayName: 'Test Member',
                username: 'testmember',
                isEmailVerified: true,
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
            }
        },
        { upsert: true }
    );
    console.log(`✓ [${targetDbName}] Seeded Member User`);

    // 3. Seed Creator Page
    await db.collection('creatorpages').updateOne(
        { _id: creatorPageId },
        {
            $set: {
                userId: creatorUserId,
                pageSlug: 'commons',
                displayName: 'commons',
                tagline: 'A place where Pakistani creators get paid.',
                about: 'Official page for Commons platform creators on Oregon.',
                status: 'published',
                isPublic: true,
                memberCount: 1,
                postCount: 1,
                category: ['Politics', 'Philosophy', 'Technology'],
                theme: {
                    primaryColor: '#6366f1',
                    accentColor: '#ec4899',
                    layout: 'default'
                },
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
            }
        },
        { upsert: true }
    );
    console.log(`✓ [${targetDbName}] Seeded Creator Page (@commons)`);

    // 4. Seed Tier
    await db.collection('tiers').updateOne(
        { _id: tierId },
        {
            $set: {
                creatorId: creatorUserId,
                pageId: creatorPageId,
                name: 'Supporter Tier',
                price: 500,
                description: 'Support Commons community and get access to exclusive content.',
                benefits: ['Early access to videos', 'Supporter badge'],
                status: 'published',
                activeSubscribers: 1,
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
            }
        },
        { upsert: true }
    );
    console.log(`✓ [${targetDbName}] Seeded Tier`);

    // 5. Seed Post
    await db.collection('posts').updateOne(
        { _id: postId },
        {
            $set: {
                creatorId: creatorUserId,
                pageId: creatorPageId,
                caption: 'Welcome to Commons! This is the official launch post on Oregon.',
                postType: 'text',
                visibility: 'public',
                status: 'published',
                publishedAt: new Date(),
                allowComments: true,
                isPinned: true,
                viewCount: 15,
                likeCount: 5,
                commentCount: 0,
                tags: ['commons', 'welcome'],
                updatedAt: new Date(),
            },
            $setOnInsert: {
                createdAt: new Date(),
            }
        },
        { upsert: true }
    );
    console.log(`✓ [${targetDbName}] Seeded Public Published Post`);

    const collections = await db.listCollections().toArray();
    console.log(`Current collections in [${targetDbName}]:`, collections.map(c => c.name));

    await conn.close();
}

async function run() {
    try {
        await seedDb('commons');
        await seedDb('commons2dot0');
        console.log('\n======================================================');
        console.log('✅ BOTH Oregon databases (commons & commons2dot0) seeded!');
        console.log('======================================================\n');
    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
}

run();
