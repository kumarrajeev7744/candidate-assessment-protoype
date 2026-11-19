import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // First run may download the MongoDB binary for mongodb-memory-server.
    hookTimeout: 120_000,
    // Test-only values; real secrets come from server/.env or AWS Secrets Manager.
    // Explicit empty SMTP values keep a developer's local .env from enabling real email in tests.
    env: {
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdefghijklmnop',
      JWT_EXPIRES_IN: '1h',
      CLIENT_URL: 'http://localhost:5173',
      SMTP_HOST: 'smtp.test.invalid',
      SMTP_USER: 'sender@example.com',
      SMTP_PASS: 'test-app-password',
      SMTP_FROM: 'Candidate Assessment <sender@example.com>',
      EMAIL_TIMEZONE: 'UTC',
      AWS_REGION: 'ap-south-1',
      S3_VIDEO_BUCKET: 'test-video-bucket',
      AWS_ACCESS_KEY_ID: 'AKIATESTONLY',
      AWS_SECRET_ACCESS_KEY: 'test-only-secret',
      VIDEO_MAX_MB: '200',
      VIDEO_URL_EXPIRES_IN: '15m',
    },
  },
});
