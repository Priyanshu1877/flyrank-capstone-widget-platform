import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../modules/auth/auth.utils.js';
import { UnauthorizedError } from '../shared/errors.js';

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new UnauthorizedError('Authorization header is required');
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedError('Authorization header must use Bearer scheme');
  }

  try {
    const payload = verifyToken(token);

    if (!payload.sub || !payload.tenantId || !payload.role) {
      throw new UnauthorizedError('Token contains incomplete identity claims');
    }

    req.auth = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
    };

    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      throw err;
    }
    // Mask internal JWT library error details from clients
    throw new UnauthorizedError('Invalid or expired authentication token');
  }
};
