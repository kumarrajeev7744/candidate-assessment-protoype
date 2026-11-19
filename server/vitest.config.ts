import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // First run may download the MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
  },
});
