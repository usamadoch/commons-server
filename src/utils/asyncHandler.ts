import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Higher-order function to wrap async Express route handlers.
 * Catches any rejected promises and passes errors to next() automatically.
 * Note: Express 5 natively catches rejected promises, but this wrapper is
 * helpful for explicit typing and backwards/cross-project consistency.
 */
export const asyncHandler = <T = RequestHandler>(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

export default asyncHandler;
