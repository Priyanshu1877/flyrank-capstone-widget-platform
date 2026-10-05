import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(
    `[FlyRank Widget Platform] Server running on port ${env.PORT} in ${env.NODE_ENV} mode`,
  );
  console.log(`[FlyRank Widget Platform] Health check: http://localhost:${env.PORT}/health`);
});

process.on('SIGTERM', () => {
  console.log('[FlyRank Widget Platform] SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('[FlyRank Widget Platform] HTTP server closed');
  });
});
