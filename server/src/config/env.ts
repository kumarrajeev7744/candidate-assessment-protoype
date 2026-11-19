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
  /** Public frontend URL used to build links in emails (first CLIENT_URL entry). */
  appBaseUrl: string;
  smtp: SmtpConfig;
  /** IANA time zone used to format dates in emails (e.g. Asia/Kolkata). */
  emailTimeZone: string;
  video: VideoStorageConfig;
}

export interface VideoStorageConfig {
  /** AWS region of the video bucket. Credentials come from the AWS default provider chain. */
  region: string | undefined;
  bucket: string | undefined;
  /** Optional S3-compatible endpoint for local development (e.g. MinIO). Leave unset for AWS. */
  endpoint: string | undefined;
  /** Maximum accepted video size in bytes (VIDEO_MAX_MB). */
  maxBytes: number;
  /** Lifetime of presigned upload/playback URLs in seconds. */
  urlExpiresInSeconds: number;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  pass: string | undefined;
  from: string | undefined;
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

function parseTimeZone(value: string | undefined): string {
  const tz = value?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
  } catch {
    throw new Error(`Invalid EMAIL_TIMEZONE value: ${value}`);
  }
  return tz;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const clientUrls = (env.CLIENT_URL ?? 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const smtpPort = env.SMTP_PORT?.trim() ? Number(env.SMTP_PORT) : 587;
  if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
    throw new Error(`Invalid SMTP_PORT value: ${env.SMTP_PORT}`);
  }
  return {
    port: parsePort(env.PORT),
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    clientUrls,
    mongodbUri: env.MONGODB_URI?.trim() || undefined,
    jwtSecret: env.JWT_SECRET || undefined,
    jwtExpiresInSeconds: parseDurationSeconds(env.JWT_EXPIRES_IN, 3600, 'JWT_EXPIRES_IN'),
    trustProxy: parseNonNegativeInt(env.TRUST_PROXY, 0, 'TRUST_PROXY'),
    loginRateLimit: {
      windowMs: 15 * 60 * 1000,
      max: parseNonNegativeInt(env.LOGIN_RATE_LIMIT_MAX, 10, 'LOGIN_RATE_LIMIT_MAX') || 10,
    },
    appBaseUrl: clientUrls[0] ?? 'http://localhost:5173',
    smtp: {
      host: env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      port: smtpPort,
      // Port 587 uses STARTTLS (secure=false); set SMTP_SECURE=true only for port 465.
      secure: env.SMTP_SECURE?.trim().toLowerCase() === 'true',
      user: env.SMTP_USER?.trim() || undefined,
      // Gmail shows App Passwords with spaces ("abcd efgh ijkl mnop"); spaces are not part of it.
      pass: env.SMTP_PASS?.replace(/\s+/g, '') || undefined,
      from: env.SMTP_FROM?.trim() || undefined,
    },
    emailTimeZone: parseTimeZone(env.EMAIL_TIMEZONE),
    video: {
      region: env.AWS_REGION?.trim() || undefined,
      bucket: env.S3_VIDEO_BUCKET?.trim() || undefined,
      endpoint: env.S3_ENDPOINT?.trim() || undefined,
      maxBytes: (parseNonNegativeInt(env.VIDEO_MAX_MB, 200, 'VIDEO_MAX_MB') || 200) * 1024 * 1024,
      urlExpiresInSeconds: parseDurationSeconds(env.VIDEO_URL_EXPIRES_IN, 900, 'VIDEO_URL_EXPIRES_IN'),
    },
  };
}

export const config = loadConfig();
