import { IPost, MediaAttachment, ImageAttachment, VideoAttachment, PostVisibility, SanitizedPostResponse, LockedPostResponse, UnlockedPostResponse, LockedMediaAttachment } from '../types/index.js';
import { generateBlurredImageUrl, generateBlurredVideoThumbnail } from './cloudinaryTransforms.js';
import { AccessContext, hasAccessToPost } from './postAccessControl.js';

function generateTeaser(caption: string | null | undefined): string {
    if (!caption?.trim()) {
        return "";
    }

    const trimmed = caption.trim();
    let preview = trimmed;

    // Use 60 chars as requested
    const LIMIT = 60;

    if (trimmed.length > LIMIT) {
        preview = trimmed.slice(0, LIMIT);
        const lastSpaceIndex = preview.lastIndexOf(' ');
        if (lastSpaceIndex > 0) {
            preview = preview.slice(0, lastSpaceIndex);
        } else {
            // No space found within limit. Include the whole first word.
            const nextSpaceIndex = trimmed.indexOf(' ', LIMIT);
            if (nextSpaceIndex > 0) {
                preview = trimmed.slice(0, nextSpaceIndex);
            } else {
                preview = trimmed;
            }
        }
        preview = preview.trimEnd();
    }

    return preview;
}

function sanitizeLockedMedia(attachment: MediaAttachment): LockedMediaAttachment {
    if (attachment.type === 'image') {
        const imageAtt = attachment as ImageAttachment;
        return {
            type: 'image',
            url: null,
            thumbnailUrl: generateBlurredImageUrl(imageAtt.cloudinaryPublicId),
            filename: attachment.filename,
            fileSize: attachment.fileSize,
            mimeType: attachment.mimeType,
            dimensions: attachment.dimensions,
        };
    }

    const videoAtt = attachment as VideoAttachment;
    return {
        type: 'video',
        url: null,
        thumbnailUrl: generateBlurredVideoThumbnail(videoAtt.muxPlaybackId),
        filename: attachment.filename,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        dimensions: attachment.dimensions,
        muxPlaybackId: null,
        muxAssetId: null,
        duration: videoAtt.duration,
        status: videoAtt.status,
    };
}

const EMBEDDABLE_PATTERNS: RegExp[] = [
    /^https?:\/\/(www\.)?(m\.)?youtube\.com\//,
    /^https?:\/\/youtu\.be\//,
];

function isEmbeddableUrl(url: string): boolean {
    return EMBEDDABLE_PATTERNS.some((pattern) => pattern.test(url));
}

function extractYouTubeVideoId(url: string): string {
    if (url.includes("youtube.com/watch?v=")) {
        return url.split("watch?v=")[1]?.split("&")[0] || "";
    }
    if (url.includes("youtu.be/")) {
        return url.split("youtu.be/")[1]?.split("?")[0] || "";
    }
    if (url.includes("youtube.com/embed/")) {
        return url.split("youtube.com/embed/")[1]?.split("?")[0] || "";
    }
    return "";
}

function getYouTubeThumbnailUrl(videoId: string): string {
    return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function getDomainLabel(url: string): string {
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, "");
        return hostname;
    } catch {
        return "External Link";
    }
}

export function sanitizePostForClient(
    post: IPost | Record<string, unknown>,
    ctx: AccessContext
): SanitizedPostResponse {
    const postData = 'toObject' in post && typeof (post as any).toObject === 'function'
        ? (post as any).toObject()
        : post;

    const basePost = {
        _id: postData._id,
        creatorId: postData.creatorId,
        pageId: postData.pageId,
        postType: postData.postType,
        visibility: postData.visibility,
        status: postData.status,
        tags: postData.tags || [],
        publishedAt: postData.publishedAt,
        scheduledFor: postData.scheduledFor,
        viewCount: postData.viewCount || 0,
        likeCount: postData.likeCount || 0,
        commentCount: postData.commentCount || 0,
        allowComments: postData.allowComments ?? true,
        isPinned: postData.isPinned ?? false,
        createdAt: postData.createdAt,
        updatedAt: postData.updatedAt,
    };

    const postForAccessCheck = {
        visibility: postData.visibility as PostVisibility,
        creatorId: postData.creatorId,
    };
    const hasAccess = hasAccessToPost(postForAccessCheck, ctx);

    if (hasAccess) {
        return {
            ...basePost,
            caption: postData.caption || '',
            mediaAttachments: postData.mediaAttachments || [],
            ...(postData.linkUrl && { linkUrl: postData.linkUrl }),
            ...(postData.poll && { poll: postData.poll }),
            isLocked: false,
        } as UnlockedPostResponse;
    }

    const lockedMedia = (postData.mediaAttachments || []).map(
        (att: MediaAttachment) => sanitizeLockedMedia(att)
    );

    const redactedPoll = postData.poll ? {
        optionCount: postData.poll.options?.length || 0,
        allowMultiple: postData.poll.allowMultiple,
        isLocked: true,
    } : undefined;

    let linkPreview: any = undefined;
    if (postData.linkUrl) {
        const url = postData.linkUrl;
        const isEmbeddable = isEmbeddableUrl(url);
        linkPreview = {
            isEmbeddable,
            domainLabel: getDomainLabel(url),
        };
        if (isEmbeddable) {
            const videoId = extractYouTubeVideoId(url);
            if (videoId) {
                linkPreview.thumbnailUrl = getYouTubeThumbnailUrl(videoId);
            }
        }
    }

    const isPoll = !!postData.poll;

    return {
        ...basePost,
        caption: isPoll ? postData.caption : null,
        teaser: isPoll ? postData.caption : generateTeaser(postData.caption),
        mediaAttachments: lockedMedia,
        ...(linkPreview && { linkPreview }),
        ...(redactedPoll && { poll: redactedPoll }),
        isLocked: true,
    } as LockedPostResponse;
}

export function sanitizePostsForClient(
    posts: (IPost | Record<string, unknown>)[],
    userId: string | null,
    membershipMap: Map<string, boolean>
): SanitizedPostResponse[] {
    return posts.map(post => {
        const postData = 'toObject' in post && typeof (post as any).toObject === 'function'
            ? (post as any).toObject()
            : post;

        const creatorId = typeof postData.creatorId === 'object' && postData.creatorId?._id
            ? postData.creatorId._id.toString()
            : postData.creatorId?.toString() || '';

        const ctx: AccessContext = {
            userId,
            isOwner: userId !== null && userId === creatorId,
            isMember: membershipMap.get(creatorId) ?? false,
        };

        return sanitizePostForClient(post, ctx);
    });
}
