import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';
import CreatorPage from '../models/CreatorPage.js';
import Post from '../models/Post.js';
import Comment from '../models/Comment.js';
import PostLike from '../models/PostLike.js';
import Member from '../models/Member.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

export const seedDatabase = async (req: Request, res: Response) => {
    // Production safety guard: Prevent seeding on production or if database is commons_prod
    const isProduction = process.env.NODE_ENV === 'production' && process.env.APP_ENV !== 'staging';
    const currentDb = mongoose.connection.name || '';
    const isProdDb = currentDb.includes('prod') || config.mongodb.uri.includes('commons_prod');

    if (isProduction || isProdDb) {
        logger.warn('Blocked attempt to seed production database', { currentDb, env: config.env });
        return res.status(403).json({
            success: false,
            error: {
                code: 'FORBIDDEN',
                message: `Database seeding is strictly prohibited on production database (${currentDb || 'production'}).`
            }
        });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        logger.info('🌱 Starting database seed...');

        // 1. Cleanup existing seed data
        const seedEmails = [
            'creator_a@test.com',
            'creator_b@test.com',
            ...Array.from({ length: 25 }, (_, i) => `member${i + 1}@test.com`)
        ];

        const existingUsers = await User.find({ email: { $in: seedEmails } }).select('_id');
        const existingUserIds = existingUsers.map(u => u._id);

        if (existingUserIds.length > 0) {
            await Promise.all([
                User.deleteMany({ _id: { $in: existingUserIds } }).session(session),
                CreatorPage.deleteMany({ userId: { $in: existingUserIds } }).session(session),
                Post.deleteMany({ creatorId: { $in: existingUserIds } }).session(session),
                Comment.deleteMany({ authorId: { $in: existingUserIds } }).session(session),
                PostLike.deleteMany({ userId: { $in: existingUserIds } }).session(session),
                Member.deleteMany({ $or: [{ memberId: { $in: existingUserIds } }, { creatorId: { $in: existingUserIds } }] }).session(session),
                Conversation.deleteMany({ $or: [{ creatorId: { $in: existingUserIds } }, { memberId: { $in: existingUserIds } }] }).session(session),
                Message.deleteMany({ senderId: { $in: existingUserIds } }).session(session),
                Notification.deleteMany({ recipientId: { $in: existingUserIds } }).session(session),
            ]);
        }

        // 2. Create Users
        const passwordHash = await bcrypt.hash('password123', 10);

        const creatorA = new User({
            email: 'creator_a@test.com',
            passwordHash,
            role: 'creator',
            displayName: 'Alice Creator',
            username: 'alice_creative',
            bio: 'Digital artist and visual storyteller.',
            isEmailVerified: true,
            notificationPreferences: {
                email: { newMembers: true, newComments: true, newMessages: true, newPosts: true },
                push: { newMembers: true, newPosts: true, newComments: true, newMessages: true },
                inApp: { all: true },
                quietHours: { enabled: false, startTime: '22:00', endTime: '08:00', timezone: 'UTC' }
            },
            avatarUrl: `https://ui-avatars.com/api/?name=Alice+Creator&background=random`
        });

        const creatorB = new User({
            email: 'creator_b@test.com',
            passwordHash,
            role: 'creator',
            displayName: 'Bob Builder',
            username: 'bob_builds',
            bio: 'Tech enthusiast and code wizard.',
            isEmailVerified: true,
            notificationPreferences: {
                email: { newMembers: true, newComments: true, newMessages: true, newPosts: true },
                push: { newMembers: true, newPosts: true, newComments: true, newMessages: true },
                inApp: { all: true },
                quietHours: { enabled: false, startTime: '22:00', endTime: '08:00', timezone: 'UTC' }
            },
            avatarUrl: `https://ui-avatars.com/api/?name=Bob+Builder&background=random`
        });

        const members: any[] = [];
        for (let i = 1; i <= 25; i++) {
            members.push(new User({
                email: `member${i}@test.com`,
                passwordHash,
                role: 'member',
                displayName: `Member ${i}`,
                username: `member_${i}`,
                bio: `Just a fan #${i}`,
                isEmailVerified: true,
                notificationPreferences: {
                    email: { newMembers: true, newComments: true, newMessages: true, newPosts: true },
                    push: { newMembers: true, newPosts: true, newComments: true, newMessages: true },
                    inApp: { all: true },
                    quietHours: { enabled: false, startTime: '22:00', endTime: '08:00', timezone: 'UTC' }
                },
                avatarUrl: `https://ui-avatars.com/api/?name=Member+${i}&background=random`
            }));
        }

        await User.insertMany([creatorA, creatorB, ...members], { session });

        // 3. Create Creator Pages
        const pageA = new CreatorPage({
            userId: creatorA._id,
            pageSlug: 'alice-creative',
            displayName: 'Alice\'s Art World',
            tagline: 'Creating digital dreams',
            category: ['Art', 'Design'],
            about: 'Welcome to my creative space where I share my latest digital art pieces and tutorials.',
            isPublic: true,
            status: 'published',
            theme: { primaryColor: '#6366f1', accentColor: '#ec4899', layout: 'default' },
            avatarUrl: `https://ui-avatars.com/api/?name=Alice+Creator&background=random`
        });

        const pageB = new CreatorPage({
            userId: creatorB._id,
            pageSlug: 'bob-tech',
            displayName: 'Bob\'s Tech Hub',
            tagline: 'Building the future',
            category: ['Tech', 'Coding'],
            about: 'Deep dives into software architecture and coding best practices.',
            isPublic: true,
            status: 'published',
            theme: { primaryColor: '#10b981', accentColor: '#3b82f6', layout: 'minimal' },
            avatarUrl: `https://ui-avatars.com/api/?name=Bob+Builder&background=random`
        });

        await CreatorPage.insertMany([pageA, pageB], { session });

        // 4. Create Members
        // Member 1 -> Alice (Active)
        const membershipActive = new Member({
            memberId: members[0]._id,
            creatorId: creatorA._id,
            pageId: pageA._id,
            status: 'active',
            joinedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
        });

        // Member 2 -> Alice (Expired/Paused)
        const membershipPaused = new Member({
            memberId: members[1]._id,
            creatorId: creatorA._id,
            pageId: pageA._id,
            status: 'paused',
            joinedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
            cancelledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
        });

        await Member.insertMany([membershipActive, membershipPaused], { session });

        // Update member counts
        pageA.memberCount = 2; // Historical count or active? Usually active + paused tailored by business logic. keeping simple.
        await pageA.save({ session });


        // 5. Create Posts (50-100 total, mix)
        const posts: any[] = [];
        const createPosts = (creator: any, page: any, count: number) => {
            for (let i = 0; i < count; i++) {
                const type = i % 3 === 0 ? 'image' : (i % 3 === 1 ? 'video' : 'text');
                const visibility = i % 5 === 0 ? 'members' : 'public';

                let mediaAttachments: any[] = [];
                if (type === 'image') {
                    mediaAttachments.push({
                        type: 'image',
                        url: `https://picsum.photos/seed/${creator.username}${i}/800/600`, // Placeholder
                        filename: `image_${i}.jpg`,
                        fileSize: 1024 * 1024,
                        mimeType: 'image/jpeg',
                        dimensions: { width: 800, height: 600 }
                    });
                } else if (type === 'video') {
                    mediaAttachments.push({
                        type: 'video',
                        url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', // Placeholder
                        filename: `video_${i}.mp4`,
                        fileSize: 5 * 1024 * 1024,
                        mimeType: 'video/mp4',
                        thumbnailUrl: `https://picsum.photos/seed/${creator.username}${i}_thumb/800/600`,
                        duration: 10,
                        status: 'ready'
                    });
                }

                posts.push(new Post({
                    creatorId: creator._id,
                    pageId: page._id,
                    caption: `This is post #${i + 1} from ${creator.displayName}. ${visibility === 'members' ? '[Members Only]' : ''} \n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.`,
                    mediaAttachments,
                    postType: type,
                    visibility,
                    status: 'published',
                    publishedAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Backdated
                    allowComments: true,
                    likeCount: 0, // Will update later
                    commentCount: 0 // Will update later
                }));
            }
        };

        createPosts(creatorA, pageA, 40);
        createPosts(creatorB, pageB, 35);

        await Post.insertMany(posts, { session });

        // 6. Create Comments (~200 distributed) & Likes (~50-100)
        const comments: any[] = [];
        const likes: any[] = [];

        // Randomly distribute comments and likes
        for (const post of posts) {
            // Add 0-5 comments per post
            const numComments = Math.floor(Math.random() * 6);
            for (let k = 0; k < numComments; k++) {
                const commenter = members[Math.floor(Math.random() * members.length)];
                comments.push(new Comment({
                    postId: post._id,
                    authorId: commenter._id,
                    content: `Nice post! Comment #${k + 1}`,
                    likeCount: Math.floor(Math.random() * 10)
                }));
                post.commentCount++;
            }

            // Add 0-3 likes per post
            const numLikes = Math.floor(Math.random() * 4);
            const likers = new Set();
            while (likers.size < numLikes) {
                const liker = members[Math.floor(Math.random() * members.length)];
                if (!likers.has(liker._id)) {
                    likers.add(liker._id);
                    likes.push(new PostLike({
                        postId: post._id,
                        userId: liker._id
                    }));
                }
            }
            post.likeCount += numLikes;
            await post.save({ session }); // Update counts
        }

        await Comment.insertMany(comments, { session });
        await PostLike.insertMany(likes, { session });

        // 7. Conversations & Messages
        const conversations: any[] = [];
        const messages: any[] = [];

        // 5 conversations between Creator A and random members
        for (let i = 0; i < 5; i++) {
            const member = members[i];
            const conv = new Conversation({
                participants: [creatorA._id, member._id],
                creatorId: creatorA._id,
                memberId: member._id,
                isActive: true,
                unreadCounts: { [creatorA._id.toString()]: 0, [member._id.toString()]: 0 }
            });
            conversations.push(conv);

            // Varied conversation starters and flow
            const starters = [
                "Hey Alice, love your recent work!",
                "Do you have any tips for beginners?",
                "When is your next big project coming out?",
                "I really enjoyed the last tutorial, very helpful.",
                "Just subscribed! Excited to be here."
            ];

            const replies = [
                "Thanks so much! Really appreciate the support.",
                "Yes! I'm planning a Q&A video soon to cover that.",
                "Working on something big right now, stay tuned!",
                "Glad you liked it! Let me know if you have requests.",
                "Welcome aboard! Happy to have you."
            ];

            const followUps = [
                "That sounds clear, thanks!",
                "Can't wait to see it.",
                "Awesome, I'll keep an eye out.",
                "Maybe something on color theory?",
                "Thanks again!"
            ];

            // Generate 3-6 messages per conversation
            const numMessages = 3 + Math.floor(Math.random() * 4);
            let lastMessageTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // Start 2 days ago

            for (let m = 0; m < numMessages; m++) {
                const isMemberSender = m % 2 === 0;
                const senderId = isMemberSender ? member._id : creatorA._id;
                let content = "";

                if (m === 0) content = starters[i % starters.length];
                else if (m === 1) content = replies[i % replies.length];
                else if (m === 2) content = followUps[i % followUps.length];
                else content = isMemberSender ? "Sounds good." : "Cheers!";

                // Advance time by 1-4 hours
                lastMessageTime = new Date(lastMessageTime.getTime() + (1 + Math.random() * 3) * 60 * 60 * 1000);

                const msg = new Message({
                    conversationId: conv._id,
                    senderId: senderId,
                    content: content,
                    status: 'read',
                    createdAt: lastMessageTime
                });
                messages.push(msg);

                // Update conversation last message
                if (m === numMessages - 1) {
                    conv.lastMessage = {
                        content: content,
                        senderId: senderId,
                        sentAt: lastMessageTime
                    };
                    conv.updatedAt = lastMessageTime;
                }
            }
        }

        await Conversation.insertMany(conversations, { session });
        await Message.insertMany(messages, { session });

        // 8. Notifications
        const notifications: any[] = [];
        // Notification for Creator A about new member
        notifications.push(new Notification({
            recipientId: creatorA._id,
            type: 'new_member',
            title: 'New Member',
            body: `${members[0].displayName} joined your page!`,
            actionUrl: `/creator/members`,
            isRead: false
        }));

        // Notification for Member 1 about new post
        notifications.push(new Notification({
            recipientId: members[0]._id,
            type: 'new_post',
            title: 'New Post from Alice',
            body: 'Alice posted a new video.',
            actionUrl: `/post/${posts[0]._id}`,
            isRead: true,
            readAt: new Date()
        }));

        // Misc notifications
        for (let i = 0; i < 5; i++) {
            notifications.push(new Notification({
                recipientId: creatorA._id,
                type: 'post_liked',
                title: 'New Like',
                body: `Someone liked your post`,
                actionUrl: `/post/${posts[i]._id}`,
                isRead: true
            }));
        }

        await Notification.insertMany(notifications, { session });

        await session.commitTransaction();
        logger.info('✅ Database seeded successfully!');

        res.status(200).json({
            success: true,
            message: 'Database seeded successfully',
            data: {
                creators: 2,
                members: members.length,
                posts: posts.length,
                comments: comments.length,
                likes: likes.length,
                conversations: conversations.length
            }
        });

    } catch (error) {
        await session.abortTransaction();
        logger.error('❌ Seeding failed:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'SEED_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error'
            }
        });
    } finally {
        session.endSession();
    }
};
