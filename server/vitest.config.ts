import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // First run may download the MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
    // Test-only values; real secrets come from server/.env or AWS Secrets Manager.
    env: {
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdefghijklmnop',
      JWT_EXPIRES_IN: '1h',
    },
  },
});
