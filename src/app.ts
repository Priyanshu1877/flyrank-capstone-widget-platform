import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { widgetDeliveryRouter } from './modules/widgets/widget-delivery.routes.js';
import { widgetRouter } from './modules/widgets/widget.routes.js';

export const createApp = (): Express => {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(
    cors({
      origin: env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
    }),
  );
  app.use(express.json({ limit: '16kb' }));

  // Minimal health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  // Public widget delivery endpoints (loader script & public config)
  app.use(widgetDeliveryRouter);

  // Authentication & Identity domain routes
  app.use('/api/v1/auth', authRouter);

  // Authenticated Widget Management routes
  app.use('/api/v1/widgets', widgetRouter);

  // Central error handling middleware
  app.use(errorHandler);

  return app;
};

export const app = createApp();
