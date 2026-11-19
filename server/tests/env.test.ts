import { describe, it, expect } from 'vitest';
import { loadConfig, parseDurationSeconds } from '../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 4000,
      nodeEnv: 'development',
      clientUrls: ['http://localhost:5173'],
      mongodbUri: undefined,
      jwtSecret: undefined,
      jwtExpiresInSeconds: 3600,
      trustProxy: 0,
      loginRateLimit: { windowMs: 15 * 60 * 1000, max: 10 },
      appBaseUrl: 'http://localhost:5173',
      smtp: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: undefined,
        pass: undefined,
        from: undefined,
      },
      emailTimeZone: 'UTC',
      video: { region: undefined, bucket: undefined, endpoint: undefined, maxBytes: 200 * 1024 * 1024, urlExpiresInSeconds: 900 },
    });
  });

  it('parses video storage settings', () => {
    const cfg = loadConfig({ AWS_REGION: 'ap-south-1', S3_VIDEO_BUCKET: 'b', VIDEO_MAX_MB: '50', VIDEO_URL_EXPIRES_IN: '5m' });
    expect(cfg.video).toEqual({ region: 'ap-south-1', bucket: 'b', endpoint: undefined, maxBytes: 50 * 1024 * 1024, urlExpiresInSeconds: 300 });
  });

  it('parses SMTP settings and strips spaces from Gmail App Passwords', () => {
    const cfg = loadConfig({
      SMTP_USER: 'sender@gmail.com',
      SMTP_PASS: 'abcd efgh ijkl mnop',
      SMTP_FROM: 'Recruiting <sender@gmail.com>',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      EMAIL_TIMEZONE: 'Asia/Kolkata',
      CLIENT_URL: 'https://app.example.com/, http://localhost:5173',
    });
    expect(cfg.smtp).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'sender@gmail.com',
      pass: 'abcdefghijklmnop',
      from: 'Recruiting <sender@gmail.com>',
    });
    expect(cfg.emailTimeZone).toBe('Asia/Kolkata');
    expect(cfg.appBaseUrl).toBe('https://app.example.com');
  });

  it('parses provided values', () => {
    const cfg = loadConfig({
      CLIENT_URL: 'http://a.com, http://b.com',
      PORT: '8080',
      NODE_ENV: 'production',
      JWT_SECRET: 's'.repeat(40),
      JWT_EXPIRES_IN: '30m',
      TRUST_PROXY: '1',
      LOGIN_RATE_LIMIT_MAX: '5',
    });
    expect(cfg).toMatchObject({
      port: 8080,
      nodeEnv: 'production',
      clientUrls: ['http://a.com', 'http://b.com'],
      jwtSecret: 's'.repeat(40),
      jwtExpiresInSeconds: 1800,
      trustProxy: 1,
      loginRateLimit: { max: 5 },
    });
  });

  it('rejects invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ JWT_EXPIRES_IN: 'soon' })).toThrow(/Invalid JWT_EXPIRES_IN/);
    expect(() => loadConfig({ TRUST_PROXY: '-1' })).toThrow(/Invalid TRUST_PROXY/);
    expect(() => loadConfig({ SMTP_PORT: 'x' })).toThrow(/Invalid SMTP_PORT/);
    expect(() => loadConfig({ EMAIL_TIMEZONE: 'Mars/Base' })).toThrow(/Invalid EMAIL_TIMEZONE/);
  });
});

describe('parseDurationSeconds', () => {
  it.each([
    ['3600', 3600],
    ['90s', 90],
    ['30m', 1800],
    ['1h', 3600],
    ['7d', 604800],
  ])('parses %s', (input, expected) => {
    expect(parseDurationSeconds(input, 1, 'X')).toBe(expected);
  });

  it('uses the fallback when empty and rejects zero', () => {
    expect(parseDurationSeconds(undefined, 42, 'X')).toBe(42);
    expect(() => parseDurationSeconds('0', 1, 'X')).toThrow(/greater than zero/);
  });
});
