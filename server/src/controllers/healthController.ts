import type { Request, Response } from 'express';
import { describeDatabaseState, isDatabaseConnected } from '../config/database.js';

/**
 * Liveness, used by the load-balancer health check: always 200 while the process serves HTTP, with
 * no auth and no database round-trip. The MongoDB state is reported for information only, so a
 * short database blip never makes the load balancer replace healthy tasks.
 */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'candidate-assessment-api',
    database: describeDatabaseState(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}

/**
 * Readiness: also requires the MongoDB connection. Returns 503 while the database is unreachable.
 * Meant for monitoring; not used as the load-balancer health check, so a short database outage does not
 * make ECS replace otherwise healthy instances.
 */
export function getReadiness(_req: Request, res: Response): void {
  const database = isDatabaseConnected() ? 'connected' : 'disconnected';
  res.status(database === 'connected' ? 200 : 503).json({
    status: database === 'connected' ? 'ok' : 'unavailable',
    database,
    timestamp: new Date().toISOString(),
  });
}
