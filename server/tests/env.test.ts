import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      mongodbUri: undefined,
      port: 4000,
      nodeEnv: 'development',
      clientUrls: ['http://localhost:5173'],
    });
  });

  it('parses multiple client URLs', () => {
    const cfg = loadConfig({ CLIENT_URL: 'http://a.com, http://b.com', PORT: '8080', NODE_ENV: 'production' });
    expect(cfg).toMatchObject({ port: 8080, nodeEnv: 'production', clientUrls: ['http://a.com', 'http://b.com'] });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
  });
});
