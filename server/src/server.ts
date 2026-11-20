import type { Server } from 'node:http';
import { createApp } from './app.js';
import { assertRequiredEnv, config } from './config/env.js';
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
/** ECS sends SIGTERM, then SIGKILL after the stop timeout (30 s by default): finish in-flight requests, then exit regardless. */
const SHUTDOWN_GRACE_MS = 10_000;

let server: Server | undefined;
let shuttingDown = false;

/** Bind on all IPv4 interfaces so the container port is reachable from the load balancer. */
const HOST = '0.0.0.0';

async function start(): Promise<void> {
  assertRequiredEnv(); // fail fast, naming every missing variable
  if (!process.env.FRONTEND_URL && process.env.CLIENT_URL) {
    logger.warn('CLIENT_URL is deprecated; rename it to FRONTEND_URL');
  }
  getJwtSecret(); // fail fast if JWT_SECRET is weak or a placeholder
  const { errors, warnings } = checkProductionConfig(config);
  for (const warning of warnings) logger.warn('Configuration warning', { warning });
  if (errors.length > 0) throw new Error(`Invalid production configuration: ${errors.join(' ')}`);

  await connectDatabase(config.mongodbUri);
  const app = createApp();
  server = app.listen(config.port, HOST, () => {
    logger.info(`API listening on ${HOST}:${config.port}`, { env: config.nodeEnv, trustProxy: config.trustProxy });
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
