import type { Request, Response } from 'express';
import { isDatabaseConnected } from '../config/database.js';

/** Liveness: the process is up and serving HTTP. Used by the App Runner health check. */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'candidate-assessment-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}

/**
 * Readiness: also requires the MongoDB connection. Returns 503 while the database is unreachable.
 * Meant for monitoring; not used as the App Runner health check, so a short database outage does not
 * make App Runner replace otherwise healthy instances.
 */
export function getReadiness(_req: Request, res: Response): void {
  const database = isDatabaseConnected() ? 'connected' : 'disconnected';
  res.status(database === 'connected' ? 200 : 503).json({
    status: database === 'connected' ? 'ok' : 'unavailable',
    database,
    timestamp: new Date().toISOString(),
  });
}
