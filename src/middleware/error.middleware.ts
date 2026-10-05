import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/errors.js';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = (res.locals.requestId as string) || 'unknown';

  if (err instanceof AppError) {
    if (
      'retryAfterSeconds' in err &&
      typeof (err as { retryAfterSeconds: number }).retryAfterSeconds === 'number'
    ) {
      res.setHeader(
        'Retry-After',
        String((err as { retryAfterSeconds: number }).retryAfterSeconds),
      );
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Handle entity too large (payload exceeds 16 KB)
  if (
    ('type' in err && (err as { type: string }).type === 'entity.too.large') ||
    ('status' in err && (err as { status: number }).status === 413)
  ) {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request payload exceeds the 16 KB size limit',
        requestId,
      },
    });
    return;
  }

  // Handle Zod or body parser JSON syntax errors
  if ('type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Malformed JSON payload',
        requestId,
      },
    });
    return;
  }

  console.error(`[Unhandled Error] Request ${requestId}:`, err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
      requestId,
    },
  });
};
