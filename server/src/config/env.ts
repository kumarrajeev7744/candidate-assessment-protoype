import 'dotenv/config';

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
  clientUrls: string[];
  /** MongoDB connection string. Required at server startup, optional for unit tests. */
  mongodbUri: string | undefined;
  /** HMAC secret for admin JWTs. Validated (presence + strength) where it is used. */
  jwtSecret: string | undefined;
  /** JWT lifetime in seconds (JWT_EXPIRES_IN accepts e.g. "1h", "30m", "3600"). */
  jwtExpiresInSeconds: number;
  /** Number of proxy hops to trust for client IPs (App Runner sits behind a load balancer). */
  trustProxy: number;
  loginRateLimit: { windowMs: number; max: number };
}

const DURATION_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') return value;
  return 'development';
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return port;
}

/** Parses "3600", "90s", "30m", "1h" or "7d" into seconds. */
export function parseDurationSeconds(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const match = /^(\d+)\s*([smhd]?)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid ${name} value: ${value}`);
  const seconds = Number(match[1]) * (DURATION_UNITS[match[2] || 's'] ?? 1);
  if (seconds <= 0) throw new Error(`${name} must be greater than zero`);
  return seconds;
}

function parseNonNegativeInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${name} value: ${value}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    clientUrls: (env.CLIENT_URL ?? 'http://localhost:5173')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    mongodbUri: env.MONGODB_URI?.trim() || undefined,
    jwtSecret: env.JWT_SECRET || undefined,
    jwtExpiresInSeconds: parseDurationSeconds(env.JWT_EXPIRES_IN, 3600, 'JWT_EXPIRES_IN'),
    trustProxy: parseNonNegativeInt(env.TRUST_PROXY, 0, 'TRUST_PROXY'),
    loginRateLimit: {
      windowMs: 15 * 60 * 1000,
      max: parseNonNegativeInt(env.LOGIN_RATE_LIMIT_MAX, 10, 'LOGIN_RATE_LIMIT_MAX') || 10,
    },
  };
}

export const config = loadConfig();
