import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { assertRequiredEnv, findMissingRequiredEnv, loadConfig, REQUIRED_SERVER_ENV } from '../src/config/env.js';

const completeEnv: NodeJS.ProcessEnv = {
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/db',
  JWT_SECRET: 'x'.repeat(48),
  SMTP_USER: 'sender@example.com',
  SMTP_PASS: 'abcdabcdabcdabcd',
  S3_VIDEO_BUCKET: 'bucket',
  AWS_REGION: 'ap-south-1',
  FRONTEND_URL: 'https://app.example.com',
};

describe('GET /api/health (load-balancer health check)', () => {
  it('returns 200 without authentication and reports the MongoDB state without failing on it', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'disconnected' });
  });
});

describe('CORS allowlist from FRONTEND_URL', () => {
  const app = createApp();
  const preflight = (origin: string) =>
    request(app).options('/api/invitations').set('Origin', origin).set('Access-Control-Request-Method', 'GET');

  it('allows the configured FRONTEND_URL origin', async () => {
    expect(process.env.FRONTEND_URL).toBe('http://localhost:5173');
    const res = await preflight('http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const get = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(get.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not allow other origins', async () => {
    for (const origin of ['https://evil.example.com', 'http://localhost:3000', 'http://localhost:5173.evil.com']) {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('reads a comma-separated FRONTEND_URL and prefers it over the legacy CLIENT_URL', () => {
    expect(loadConfig({ FRONTEND_URL: 'https://a.example.com, https://b.example.com/' }).clientUrls).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(loadConfig({ FRONTEND_URL: 'https://new.example.com', CLIENT_URL: 'https://old.example.com' }).clientUrls).toEqual([
      'https://new.example.com',
    ]);
    expect(loadConfig({ CLIENT_URL: 'https://old.example.com' }).clientUrls).toEqual(['https://old.example.com']);
  });
});

describe('trust proxy', () => {
  it('trusts one proxy hop (the ALB) in production by default; TRUST_PROXY overrides', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).trustProxy).toBe(1);
    expect(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ NODE_ENV: 'development' }).trustProxy).toBe(0);
  });
});

describe('required environment variables (fail fast at startup)', () => {
  it('accepts a complete environment', () => {
    expect(findMissingRequiredEnv(completeEnv)).toEqual([]);
    expect(() => assertRequiredEnv(completeEnv)).not.toThrow();
  });

  it('lists every missing variable by name in one clear error', () => {
    expect(findMissingRequiredEnv({})).toEqual([...REQUIRED_SERVER_ENV]);
    expect(() => assertRequiredEnv({})).toThrow(
      /Missing required environment variable\(s\): MONGODB_URI, JWT_SECRET, SMTP_USER, SMTP_PASS, S3_VIDEO_BUCKET, AWS_REGION, FRONTEND_URL/,
    );
  });

  it.each(REQUIRED_SERVER_ENV)('fails when %s is missing or blank', (name) => {
    expect(findMissingRequiredEnv({ ...completeEnv, [name]: undefined })).toEqual([name]);
    expect(findMissingRequiredEnv({ ...completeEnv, [name]: '   ' })).toEqual([name]);
  });

  it('accepts the legacy CLIENT_URL in place of FRONTEND_URL', () => {
    expect(findMissingRequiredEnv({ ...completeEnv, FRONTEND_URL: undefined, CLIENT_URL: 'https://app.example.com' })).toEqual([]);
  });

  it('never includes variable values in the error', () => {
    const env = { ...completeEnv, MONGODB_URI: undefined };
    expect(() => assertRequiredEnv(env)).toThrow(/MONGODB_URI/);
    try {
      assertRequiredEnv(env);
    } catch (err) {
      expect((err as Error).message).not.toContain(completeEnv.SMTP_PASS);
      expect((err as Error).message).not.toContain(completeEnv.JWT_SECRET);
    }
  });
});

describe('values passed with docker --env-file', () => {
  it('accepts SMTP_FROM with or without surrounding quotes', () => {
    const expected = 'Candidate Assessment <sender@example.com>';
    expect(loadConfig({ SMTP_FROM: '"Candidate Assessment <sender@example.com>"' }).smtp.from).toBe(expected);
    expect(loadConfig({ SMTP_FROM: "'Candidate Assessment <sender@example.com>'" }).smtp.from).toBe(expected);
    expect(loadConfig({ SMTP_FROM: expected }).smtp.from).toBe(expected);
    expect(loadConfig({ SMTP_FROM: '"Acme" <a@example.com>' }).smtp.from).toBe('"Acme" <a@example.com>');
  });
});
