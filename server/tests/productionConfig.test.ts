import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { checkProductionConfig } from '../src/config/productionChecks.js';
import { createApp } from '../src/app.js';
import { redactPath } from '../src/middleware/requestLogger.js';

const prodEnv = {
  NODE_ENV: 'production',
  FRONTEND_URL: 'https://app.example.com',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.net/candidate_assessment',
  TRUST_PROXY: '1',
  SMTP_USER: 'sender@example.com',
  SMTP_PASS: 'abcdabcdabcdabcd',
  SMTP_FROM: 'Assessments <sender@example.com>',
  AWS_REGION: 'ap-south-1',
  S3_VIDEO_BUCKET: 'videos-bucket',
};

function check(overrides: Record<string, string | undefined>) {
  const env = { ...prodEnv, ...overrides };
  return checkProductionConfig(loadConfig(env), env);
}

describe('checkProductionConfig', () => {
  it('accepts a complete production configuration without warnings', () => {
    expect(check({})).toEqual({ errors: [], warnings: [] });
  });

  it('skips all checks outside production', () => {
    expect(check({ NODE_ENV: 'development', FRONTEND_URL: undefined, TRUST_PROXY: '0' })).toEqual({ errors: [], warnings: [] });
  });

  it('requires an explicit https, non-localhost, origin-only FRONTEND_URL', () => {
    expect(check({ FRONTEND_URL: undefined }).errors).toHaveLength(1);
    expect(check({ FRONTEND_URL: 'http://app.example.com' }).errors[0]).toMatch(/https/);
    expect(check({ FRONTEND_URL: 'https://localhost:5173' }).errors[0]).toMatch(/localhost/);
    expect(check({ FRONTEND_URL: 'https://app.example.com/admin' }).errors[0]).toMatch(/origins only/);
    expect(check({ FRONTEND_URL: 'https://a.example.com,https://b.example.com/' }).errors).toEqual([]);
  });

  it('requires MONGODB_URI', () => {
    expect(check({ MONGODB_URI: undefined }).errors).toContain('MONGODB_URI must be set.');
  });

  it('warns about settings that break App Runner deployments, without echoing secret values', () => {
    const { errors, warnings } = check({
      TRUST_PROXY: '0',
      SMTP_FROM: undefined,
      AWS_ACCESS_KEY_ID: 'AKIAEXAMPLEKEY',
      ADMIN_PASSWORD: 'super-secret-password',
      S3_ENDPOINT: 'http://localhost:9000',
    });
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(5);
    const text = warnings.join(' ');
    expect(text).toMatch(/TRUST_PROXY/);
    expect(text).not.toContain('AKIAEXAMPLEKEY');
    expect(text).not.toContain('super-secret-password');
  });
});

describe('security headers', () => {
  it('sets conservative headers on API responses, including errors', async () => {
    const app = createApp();
    for (const path of ['/api/health', '/api/does-not-exist']) {
      const res = await request(app).get(path);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
    }
  });

  it('does not send HSTS outside production', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('keeps CORS limited to the configured frontend origin', async () => {
    const app = createApp();
    const allowed = await request(app).options('/api/auth/login').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await request(app).options('/api/auth/login').set('Origin', 'https://evil.example.com').set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /api/health/ready', () => {
  it('returns 503 when the database is not connected (liveness stays 200)', async () => {
    const app = createApp();
    const ready = await request(app).get('/api/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toMatchObject({ status: 'unavailable', database: 'disconnected' });
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

describe('redactPath', () => {
  it('removes query strings and raw invitation/share tokens from logged paths', () => {
    const token = 'A'.repeat(20) + '_-' + 'b'.repeat(21);
    expect(redactPath(`/api/invitations/validate/${token}`)).toBe('/api/invitations/validate/:token');
    expect(redactPath(`/api/shared-responses/${token}?x=1`)).toBe('/api/shared-responses/:token');
    expect(redactPath('/api/candidates/64b7f0c2a1b2c3d4e5f60718/report')).toBe('/api/candidates/64b7f0c2a1b2c3d4e5f60718/report');
  });
});
