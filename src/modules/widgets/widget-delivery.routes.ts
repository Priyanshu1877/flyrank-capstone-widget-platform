import { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../../config/env.js';
import { BadRequestError } from '../../shared/errors.js';
import { buildWidgetLoaderScript } from './widget-loader.js';
import { widgetService } from './widget.service.js';

const router = Router();
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Preflight CORS for public config endpoint
router.options(
  '/api/v1/public/widgets/:id/config',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const origin = req.headers.origin;
      const widgetId = req.params.id as string;

      const { matchedOrigin } = await widgetService.getPublicConfig(widgetId, origin);

      if (matchedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', matchedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.setHeader('Vary', 'Origin');
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// Public widget configuration endpoint with origin allowlist and ETag revalidation
router.get(
  '/api/v1/public/widgets/:id/config',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const origin = req.headers.origin;
      const widgetId = req.params.id as string;

      const { config, etag, matchedOrigin } = await widgetService.getPublicConfig(widgetId, origin);

      // Apply CORS header when requested with origin
      if (matchedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', matchedOrigin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      }

      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Origin, Accept-Encoding');

      // ETag revalidation (supports exact match or normalized comparison)
      const clientETag = req.headers['if-none-match'];
      if (clientETag) {
        const normalizeETag = (t: string) => t.replace(/^W\//, '').replace(/"/g, '').trim();
        if (clientETag === etag || normalizeETag(clientETag) === normalizeETag(etag)) {
          res.status(304).end();
          return;
        }
      }

      res.status(200).json({
        status: 'success',
        data: config,
      });
    } catch (err) {
      next(err);
    }
  },
);

// Public widget.js embed loader delivery
router.get('/widget.js', (req: Request, res: Response): void => {
  const widgetId = req.query.id;

  if (typeof widgetId !== 'string' || !UUID_REGEX.test(widgetId)) {
    throw new BadRequestError(
      'A valid UUID widget "id" query parameter is required (e.g. /widget.js?id=UUID)',
    );
  }

  const scriptContent = buildWidgetLoaderScript(widgetId, env.WIDGET_BASE_URL);

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.setHeader('Vary', 'Accept-Encoding');
  res.status(200).send(scriptContent);
});

export const widgetDeliveryRouter = router;
