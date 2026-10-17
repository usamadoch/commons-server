import { Router, RequestHandler } from 'express';
import { protect, optionalAuth, requireCreator } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createPostSchema, updatePostSchema, createCommentSchema } from '../utils/validators.js';
import {
    getPostById,
    recordPostView,
    createPost,
    updatePost,
    deletePost
} from '../controllers/postCrudControllers.js';
import {
    getMyPosts,
    getCreatorPosts,
    getRecentVideos,
    getHomeFeed
} from '../controllers/feedControllers.js';
import {
    toggleLikePost,
    toggleLikeComment,
    getPostComments,
    addPostComment,
    votePoll
} from '../controllers/interactionControllers.js';
const router = Router();

// Creator dashboard: my own posts (paginated, lean)
router.get('/my', protect, requireCreator, getMyPosts as RequestHandler);

// Public: creator's posts by slug (lean, with access control)
router.get('/creator', optionalAuth, getCreatorPosts as RequestHandler);



// Get recent videos
router.get('/recent-videos', optionalAuth, getRecentVideos as RequestHandler);

// Home feed: posts from subscribed creators (cursor-based)
router.get('/feed', protect, getHomeFeed as RequestHandler);

// Get single post
router.get('/:id', optionalAuth, getPostById as RequestHandler);

// Record post view
router.post('/:id/view', optionalAuth, recordPostView as RequestHandler);

// Create post (creator only)
router.post(
    '/',
    protect,
    requireCreator,
    validate(createPostSchema),
    createPost as RequestHandler
);

// Update post
router.put(
    '/:id',
    protect,
    requireCreator,
    validate(updatePostSchema),
    updatePost as RequestHandler
);

// Delete post
router.delete('/:id', protect, requireCreator, deletePost as RequestHandler);

// Like / Unlike post
router.post('/:id/like', protect, toggleLikePost as RequestHandler);

// Vote on poll
router.post('/:id/vote', protect, votePoll as RequestHandler);

// Get comments
router.get('/:id/comments', optionalAuth, getPostComments as RequestHandler);

// Add comment
router.post(
    '/:id/comments',
    protect,
    validate(createCommentSchema),
    addPostComment as RequestHandler
);

// Like / Unlike comment
router.post('/comments/:id/like', protect, toggleLikeComment as RequestHandler);

export default router;
