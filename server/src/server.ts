import type { Server } from 'node:http';
import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { logger } from './utils/logger.js';
import { getJwtSecret } from './utils/jwt.js';

let server: Server | undefined;
let shuttingDown = false;

async function start(): Promise<void> {
  getJwtSecret(); // fail fast if JWT_SECRET is missing or weak
  await connectDatabase(config.mongodbUri);
  const app = createApp();
  server = app.listen(config.port, () => {
    logger.info(`API listening on port ${config.port}`, { env: config.nodeEnv });
  });
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  try {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((err) => (err ? reject(err) : resolve())),
      );
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

start().catch(async (err: unknown) => {
  logger.error('Startup failed', { error: (err as Error).message });
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
