import mongoose from 'mongoose';
import User from '../src/models/User.js';
import CreatorPage from '../src/models/CreatorPage.js';
import Member from '../src/models/Member.js';
import Post from '../src/models/Post.js';
import config from '../src/config/index.js';

// Run: npx ts-node --esm scripts/test-seed.ts

async function main() {
    await mongoose.connect(config.mongodb.uri);
    console.log('Connected to Mongo');

    const runId = Date.now();

    // 1. Creator
    const creator = await User.create({
        displayName: 'Test Creator',
        username: `testcreator${runId}`,
        email: `creator-${runId}@test.local`,
        passwordHash: 'not-used-bypassing-auth',
        role: 'creator',
        isEmailVerified: true,
        notificationPreferences: {
            email: { newMembers: true, newComments: true, newMessages: true, newPosts: true },
            push: { newMembers: true, newPosts: true, newComments: true, newMessages: true },
            inApp: { all: true },
            quietHours: { enabled: false, startTime: '22:00', endTime: '08:00', timezone: 'UTC' }
        },
    });

    const creatorPage = await CreatorPage.create({
        userId: creator._id,
        pageSlug: `test-creator-${runId}`,
        displayName: 'Test Creator Page',
        tagline: 'Test Tagline',
        category: ['Art'],
        isPublic: true,
        status: 'published',
        theme: { primaryColor: '#6366f1', accentColor: '#ec4899', layout: 'default' },
        memberCount: 3,
    });

    // 2. Members (skip join/payment — just create + link directly)
    const members = await User.insertMany(
        Array.from({ length: 3 }).map((_, i) => ({
            displayName: `Test Member ${i + 1}`,
            username: `testmember_${runId}_${i}`,
            email: `member${i}-${runId}@test.local`,
            passwordHash: 'not-used-bypassing-auth',
            role: 'member',
            isEmailVerified: true,
            notificationPreferences: {
                email: { newMembers: true, newComments: true, newMessages: true, newPosts: true },
                push: { newMembers: true, newPosts: true, newComments: true, newMessages: true },
                inApp: { all: true },
                quietHours: { enabled: false, startTime: '22:00', endTime: '08:00', timezone: 'UTC' }
            },
        }))
    );

    // Create active memberships
    await Member.insertMany(members.map(m => ({
        memberId: m._id,
        creatorId: creator._id,
        pageId: creatorPage._id,
        status: 'active',
        joinedAt: new Date()
    })));

    // 3. Post
    const post = await Post.create({
        creatorId: creator._id,
        pageId: creatorPage._id,
        caption: 'Test post for notification checks',
        postType: 'text',
        visibility: 'public',
        status: 'draft', // Start as draft so trigger script can publish it
        allowComments: true,
        likeCount: 0,
        commentCount: 0
    });

    console.log('\n--- SEED COMPLETE ---');
    console.log(`const CREATOR_ID = '${creator._id.toString()}';`);
    console.log(`const MEMBER_IDS = ${JSON.stringify(members.map((m) => m._id.toString()))};`);
    console.log(`const POST_ID = '${post._id.toString()}';`);
    console.log('---------------------\n');

    await mongoose.disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
