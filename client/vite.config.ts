/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { checkApiBaseUrl } from './src/utils/apiBaseUrlCheck';

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const { error, warning } = checkApiBaseUrl(env.VITE_API_BASE_URL);
    if (error) throw new Error(error);
    if (warning) console.warn(`\n⚠ ${warning}\n`);
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
    build: {
      // Never publish source maps (they expose the full source); hashed file names allow long caching.
      sourcemap: false,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.{ts,tsx}'],
    },
  };
});
