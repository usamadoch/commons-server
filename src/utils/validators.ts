import { z } from 'zod';



const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Auth schemas
export const signupSchema = z.object({
    email: z.string().min(1, { message: "Email is required" }).regex(EMAIL_REGEX, { message: "Invalid email address" }),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
    displayName: z.string().min(2, 'Display name must be at least 2 characters').max(100),
    username: z
        .string()
        .min(3, 'Username must be at least 3 characters')
        .max(30)
        .regex(/^[a-z0-9_-]+$/, 'Username can only contain lowercase letters, numbers, underscores, and hyphens'),
    role: z.enum(['member', 'creator']).default('member'),
});

export const loginSchema = z.object({
    email: z.string().min(1, { message: "Email is required" }).regex(EMAIL_REGEX, { message: "Invalid email address" }),
    password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
    email: z.string().min(1, { message: "Email is required" }).regex(EMAIL_REGEX, { message: "Invalid email address" }),
});

export const checkEmailSchema = z.object({
    email: z.string().min(1, { message: "Email is required" }).regex(EMAIL_REGEX, { message: "Invalid email address" }),
});

// Reset password schema
export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number')
        .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character'),
});

// Change password schema
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number')
        .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character'),
});

// Post schemas
// Media attachment schema - base fields shared by all media types
const baseMediaSchema = z.object({
    filename: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    dimensions: z.object({
        width: z.number(),
        height: z.number(),
    }).optional(),
});

const imageAttachmentSchema = baseMediaSchema.extend({
    type: z.literal('image'),
    url: z.string().min(1, 'Image URL is required'), // Images always have URL from Cloudinary
    cloudinaryPublicId: z.string().optional(),
});

const videoAttachmentSchema = baseMediaSchema.extend({
    type: z.literal('video'),
    url: z.string().optional().default(''), // URL populated by Mux webhook later
    thumbnailUrl: z.string().optional().default(''),
    duration: z.number().optional().default(0),
    muxUploadId: z.string().optional(),
    muxAssetId: z.string().optional(),
    muxPlaybackId: z.string().optional(),
    status: z.enum(['preparing', 'ready', 'errored']).optional(),
});

const mediaAttachmentSchema = z.discriminatedUnion('type', [
    imageAttachmentSchema,
    videoAttachmentSchema,
]);

export const createPostSchema = z.object({
    caption: z.string().min(1, 'Caption is required').max(2200),
    mediaAttachments: z.array(mediaAttachmentSchema).max(10).default([]),
    visibility: z.enum(['public', 'members']).default('public'),
    postType: z.enum(['text', 'image', 'video']).default('text'),
    tags: z.array(z.string().max(30)).max(10).default([]),
    allowComments: z.boolean().default(true),
    status: z.enum(['draft', 'published']).default('draft'),
    scheduledFor: z.string().datetime().optional(),
});

export const updatePostSchema = createPostSchema.partial();

// Page schemas
export const updatePageSchema = z.object({
    displayName: z.string().min(2).max(100).optional(),
    category: z.array(z.string()).optional(),
    tagline: z.string().max(500).optional(),
    pageSlug: z
        .string()
        .min(3)
        .max(50)
        .regex(/^[a-z0-9_-]+$/)
        .optional(),
    about: z.string().max(10000).optional(),
    theme: z.object({
        primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        layout: z.enum(['default', 'minimal', 'featured']).optional(),
    }).optional(),
    isPublic: z.boolean().optional(),
    status: z.enum(['draft', 'published']).optional(),
});

// Comment schemas
export const createCommentSchema = z.object({
    content: z.string().min(1, 'Comment cannot be empty').max(2000),
    parentId: z.string().optional(),
});

// Message schemas
export const sendMessageSchema = z.object({
    content: z.string().min(1, 'Message cannot be empty').max(5000),
    contentType: z.enum(['text', 'image', 'file']).default('text'),
});

// User update schema
export const updateUserSchema = z.object({
    displayName: z.string().min(2).max(100).optional(),
    bio: z.string().max(500).optional(),
    notificationPreferences: z.object({
        email: z.object({
            newMembers: z.boolean(),
            newComments: z.boolean(),
            newMessages: z.boolean(),
            newPosts: z.boolean(),
        }).optional(),
        push: z.object({
            newMembers: z.boolean(),
            newPosts: z.boolean(),
            newComments: z.boolean(),
            newMessages: z.boolean(),
        }).optional(),
        inApp: z.object({
            all: z.boolean(),
        }).optional(),
        quietHours: z.object({
            enabled: z.boolean(),
            startTime: z.string(),
            endTime: z.string(),
            timezone: z.string(),
        }).optional(),
    }).optional(),
});

// Type exports from schemas
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
