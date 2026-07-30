export interface BaseMediaAttachment {
    url: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    dimensions?: { width: number; height: number };
}

export type MediaStatus = 'preparing' | 'ready' | 'errored';

export interface ImageAttachment extends BaseMediaAttachment {
    type: 'image';
    cloudinaryPublicId?: string; 
}

export interface VideoAttachment extends BaseMediaAttachment {
    type: 'video';
    muxUploadId?: string;
    muxAssetId?: string;
    muxPlaybackId?: string;
    status?: MediaStatus;
    thumbnailUrl: string; 
    duration: number;     
}

export type MediaAttachment = ImageAttachment | VideoAttachment;

export interface LockedImageAttachment {
    type: 'image';
    url: null;
    thumbnailUrl: string | null;
    filename: string;
    fileSize: number;
    mimeType: string;
    dimensions?: { width: number; height: number };
}

export interface LockedVideoAttachment {
    type: 'video';
    url: null;
    thumbnailUrl: string | null;
    filename: string;
    fileSize: number;
    mimeType: string;
    dimensions?: { width: number; height: number };
    muxPlaybackId: null;
    muxAssetId: null;
    duration?: number;
    status?: MediaStatus;
}

export type LockedMediaAttachment = LockedImageAttachment | LockedVideoAttachment;

export interface UploadedFile {
    url: string;
    filename: string;
    fileSize: number;
    mimeType: string;
}
