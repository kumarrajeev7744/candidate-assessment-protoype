import type { Server } from 'node:http';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { checkProductionConfig } from './config/productionChecks.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
import { getJwtSecret } from './utils/jwt.js';

/** HTTP timeouts. The keep-alive timeout is longer than typical load-balancer idle timeouts (60 s). */
export const SERVER_TIMEOUTS = {
  requestTimeoutMs: 30_000,
  headersTimeoutMs: 66_000,
  keepAliveTimeoutMs: 65_000,
} as const;
/** App Runner waits a limited time after SIGTERM; finish in-flight requests, then exit regardless. */
const SHUTDOWN_GRACE_MS = 10_000;

let server: Server | undefined;
let shuttingDown = false;

async function start(): Promise<void> {
  getJwtSecret(); // fail fast if JWT_SECRET is missing or weak
  const { errors, warnings } = checkProductionConfig(config);
  for (const warning of warnings) logger.warn('Configuration warning', { warning });
  if (errors.length > 0) throw new Error(`Invalid production configuration: ${errors.join(' ')}`);

  await connectDatabase(config.mongodbUri);
  const app = createApp();
  server = app.listen(config.port, () => {
    logger.info(`API listening on port ${config.port}`, { env: config.nodeEnv });
  });
  server.requestTimeout = SERVER_TIMEOUTS.requestTimeoutMs;
  server.headersTimeout = SERVER_TIMEOUTS.headersTimeoutMs;
  server.keepAliveTimeout = SERVER_TIMEOUTS.keepAliveTimeoutMs;
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => {
    logger.error('Graceful shutdown timed out; exiting');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();
  try {
    if (server) {
      const closing = new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
      server.closeIdleConnections();
      await closing;
    }
    await disconnectDatabase();
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: (err as Error).message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception; exiting', { error: err.message, stack: err.stack });
  process.exit(1);
});

start().catch(async (err: unknown) => {
  logger.error('Startup failed', { error: (err as Error).message });
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
