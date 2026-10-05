import path from 'path';
import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { widgetDeliveryRouter } from './modules/widgets/widget-delivery.routes.js';
import { widgetRouter } from './modules/widgets/widget.routes.js';
import { submissionRouter } from './modules/submissions/submission.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';

export const createApp = (): Express => {
  const app = express();
  const publicDir = path.join(process.cwd(), 'public');

  // Trust proxy for loopback and test environments to resolve req.ip safely
  app.set('trust proxy', env.NODE_ENV === 'test' ? true : 'loopback');

  app.use(requestIdMiddleware);
  // Dynamic CORS: Public routes evaluate origins per-widget from DB; other routes use CORS_ALLOWED_ORIGINS
  app.use((req, res, next) => {
    if (
      req.path.startsWith('/api/v1/public') ||
      req.path === '/widget.js' ||
      req.path.startsWith('/dashboard')
    ) {
      return next();
    }
    return cors({
      origin: env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
    })(req, res, next);
  });
  app.use(express.json({ limit: '16kb' }));

  // Dashboard Frontend UI routes (mounted before express.static to serve 200 directly)
  app.get(['/dashboard', '/dashboard/'], (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'dashboard', 'index.html'));
  });
  app.get('/', (_req: Request, res: Response) => {
    res.redirect('/dashboard');
  });

  // Static assets (CSS, JS, icons) for dashboard frontend
  app.use(express.static(publicDir, { redirect: false }));

  // Minimal health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Public widget delivery endpoints (loader script & public config)
  app.use(widgetDeliveryRouter);

  // Public lead submission endpoints (POST & OPTIONS /api/v1/public/submissions)
  app.use(submissionRouter);

  // Authentication & Identity domain routes
  app.use('/api/v1/auth', authRouter);

  // Authenticated Widget Management routes
  app.use('/api/v1/widgets', widgetRouter);

  // Authenticated Dashboard & Lead Management routes
  app.use('/api/v1/dashboard', dashboardRouter);

  // Central error handling middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
