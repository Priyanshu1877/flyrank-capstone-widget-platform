import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import { env } from './config/env.js';

export const createApp = (): Express => {
  const app = express();

  app.use(
    cors({
      origin: env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
    }),
  );
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
};

export const app = createApp();
