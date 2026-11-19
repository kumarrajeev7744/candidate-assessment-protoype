import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { useTestDatabase } from './helpers/db.js';
import { createApp } from '../src/app.js';
import { Admin } from '../src/models/index.js';
import { seedAdmin } from '../src/services/adminSeedService.js';

useTestDatabase();

const EMAIL = 'recruiter@example.com';
const PASSWORD = 'Correct-Horse-42!';
const SECRET = process.env.JWT_SECRET!;
const AUDIENCE = 'candidate-assessment-admin';

const app = createApp({ loginRateLimit: { windowMs: 60_000, max: 100 } });

beforeEach(async () => {
  await seedAdmin(EMAIL, PASSWORD);
});

async function loginAndGetToken(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  return res.body.token as string;
}

describe('POST /api/auth/login', () => {
  it('returns a JWT and admin identity for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '  Recruiter@Example.com ', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.admin).toEqual({ id: expect.any(String), email: EMAIL });
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const decoded = jwt.verify(res.body.token, SECRET, { audience: AUDIENCE }) as jwt.JwtPayload;
    expect(decoded.sub).toBe(res.body.admin.id);
    expect(decoded.exp! - decoded.iat!).toBe(3600);
  });

  it('returns 401 for an invalid password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  });

  it('returns 401 with the same message for an unknown email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
  });

  it('returns 400 when email and password are missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual({ email: 'Email is required', password: 'Password is required' });
  });

  it('returns 400 for a malformed email or empty password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ email: 'Email is invalid', password: 'Password is required' });
  });

  it('returns 400 for non-string values', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: 1 });
    expect(res.status).toBe(400);
  });

  it('never returns the password hash', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the admin profile for a valid JWT', async () => {
    const token = await loginAndGetToken();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.admin).toEqual({ id: expect.any(String), email: EMAIL, createdAt: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a malformed Authorization header', async () => {
    const token = await loginAndGetToken();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Token ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid JWT', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a JWT signed with a different secret', async () => {
    const admin = await Admin.findOne({ email: EMAIL });
    const forged = jwt.sign({ email: EMAIL }, 'attacker-secret-attacker-secret-1234', {
      subject: admin!.id,
      audience: AUDIENCE,
    });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for an expired JWT', async () => {
    const admin = await Admin.findOne({ email: EMAIL });
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = jwt.sign({ email: EMAIL, iat: nowSec - 7200, exp: nowSec - 3600 }, SECRET, {
      subject: admin!.id,
      audience: AUDIENCE,
    });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 if the admin account no longer exists', async () => {
    const token = await loginAndGetToken();
    await Admin.deleteMany({});
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns a simple success response', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Logged out' });
  });
});

describe('CORS', () => {
  it('allows the Authorization header from the frontend origin', async () => {
    const res = await request(app)
      .options('/api/auth/me')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
  });
});

describe('Login rate limiting', () => {
  it('blocks further attempts after too many failed logins', async () => {
    const limited = createApp({ loginRateLimit: { windowMs: 60_000, max: 3 } });
    for (let i = 0; i < 3; i++) {
      const res = await request(limited).post('/api/auth/login').send({ email: EMAIL, password: 'wrong' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(limited).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('does not count successful logins against the limit', async () => {
    const limited = createApp({ loginRateLimit: { windowMs: 60_000, max: 2 } });
    for (let i = 0; i < 4; i++) {
      const res = await request(limited).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(200);
    }
  });
});
