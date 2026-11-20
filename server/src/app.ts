import express, { type Express } from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { requestLogger } from './middleware/requestLogger.js';
import type { RateLimitOptions } from './middleware/rateLimiters.js';

export interface AppOptions {
  loginRateLimit?: RateLimitOptions;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(requestLogger);
  app.use(securityHeaders({ hsts: config.nodeEnv === 'production' }));

  app.use(
    cors({
      origin: config.clientUrls,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Assessment-Token'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', createApiRouter({ loginRateLimit: options.loginRateLimit ?? config.loginRateLimit }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
