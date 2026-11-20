import { describe, it, expect } from 'vitest';
import { checkApiBaseUrl } from '../src/utils/apiBaseUrlCheck';

describe('checkApiBaseUrl (production build guard)', () => {
  it('fails when the API URL is missing, relative or plain http on a public host', () => {
    expect(checkApiBaseUrl(undefined).error).toMatch(/not set/);
    expect(checkApiBaseUrl('  ').error).toMatch(/not set/);
    expect(checkApiBaseUrl('/api').error).toMatch(/absolute/);
    expect(checkApiBaseUrl('http://api.example.com/api').error).toMatch(/https/);
  });

  it('accepts an https API URL', () => {
    expect(checkApiBaseUrl('https://abc123.ap-south-1.awsapprunner.com/api')).toEqual({});
    expect(checkApiBaseUrl('https://api.example.com/api/')).toEqual({});
  });

  it('warns (but allows) localhost builds and URLs without /api', () => {
    expect(checkApiBaseUrl('http://localhost:4000/api').warning).toMatch(/localhost/);
    expect(checkApiBaseUrl('https://api.example.com').warning).toMatch(/\/api/);
  });
});
