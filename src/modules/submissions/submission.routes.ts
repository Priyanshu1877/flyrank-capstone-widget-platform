import { Router, type Request, type Response, type NextFunction } from 'express';
import { baseSubmissionSchema } from './submission.schema.js';
import { submissionService } from './submission.service.js';
import { ValidationError } from '../../shared/errors.js';

export const submissionRouter: Router = Router();

// Handle CORS Preflight for /api/v1/public/submissions
submissionRouter.options(
  '/api/v1/public/submissions',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const origin = req.headers.origin;
      const widgetId =
        (req.query.widgetId as string) || (req.headers['x-widget-id'] as string) || undefined;

      const { matchedOrigin } = await submissionService.handlePreflight(origin, widgetId);

      if (matchedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', matchedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, x-widget-id');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.setHeader('Vary', 'Origin');
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// Public lead submission endpoint
submissionRouter.post(
  '/api/v1/public/submissions',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Boundary validation of request wrapper
      const parseResult = baseSubmissionSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          'The submission request failed validation checks.',
          parseResult.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }

      // 2. Extract client request metadata
      const origin = req.headers.origin;
      const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
      const userAgent = req.headers['user-agent'];
      const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

      // 3. Delegate to submission service
      const { result, matchedOrigin, isNew } = await submissionService.submitLead(
        parseResult.data,
        {
          origin,
          ip,
          userAgent,
          idempotencyKey,
        },
      );

      // 4. Set CORS headers when origin was validated
      if (matchedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', matchedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, x-widget-id');
        res.setHeader('Vary', 'Origin');
      }

      const statusCode = isNew ? 201 : 200;
      res.status(statusCode).json(result);
    } catch (err) {
      next(err);
    }
  },
);
