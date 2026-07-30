import { IPost } from '../types/index.js';

export interface AccessContext {
    userId: string | null;
    isOwner: boolean;
    isMember: boolean;
}

export function hasAccessToPost(
    post: Pick<IPost, 'visibility' | 'creatorId'>,
    ctx: AccessContext
): boolean {
    if (ctx.isOwner) return true;
    if (post.visibility === 'public') return true;
    if (post.visibility === 'members' && ctx.isMember) return true;
    return false;
}
