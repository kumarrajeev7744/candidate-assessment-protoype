import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /api/health', () => {
  it('returns HTTP 200 with JSON content', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns the expected health payload', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body).toMatchObject({ status: 'ok', service: 'candidate-assessment-api' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(new Date(res.body.timestamp).toString()).not.toBe('Invalid Date');
  });
});

describe('Unknown routes', () => {
  it('returns 404 JSON for an unknown API route', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found: GET /api/does-not-exist' },
    });
  });

  it('returns 404 for unknown methods on known paths', async () => {
    const res = await request(app).delete('/api/health');
    expect(res.status).toBe(404);
  });
});

describe('Error handling', () => {
  it('returns 400 for malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('CORS', () => {
  it('allows the configured client origin', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not allow unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
