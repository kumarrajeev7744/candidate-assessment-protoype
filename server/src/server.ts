import { createApp } from './app.js';
import { config } from './config/env.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ level: 'info', message: `API listening on port ${config.port}`, env: config.nodeEnv }));
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: 'info', message: `${signal} received, shutting down` }));
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
