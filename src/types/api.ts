import { Request } from 'express';
import { Types } from 'mongoose';
import { IUser, UserRole } from './user.js';

export interface AuthenticatedRequest extends Request {
    user: IUser;
}

export interface MaybeAuthenticatedRequest extends Request {
    user?: IUser;
}

export interface SuccessResponse<T> {
    success: true;
    data: T;
    meta?: {
        pagination?: Pagination;
        [key: string]: unknown;
    };
}

export interface ErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: Record<string, string[]>;
    };
}

export interface Pagination {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

export interface JWTPayload {
    userId: string;
    email: string;
    role: UserRole;
}

export interface IRefreshToken {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    token: string;
    expiresAt: Date;
    createdAt: Date;
}
