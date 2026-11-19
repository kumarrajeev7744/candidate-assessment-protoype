import 'dotenv/config';

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  port: number;
  nodeEnv: NodeEnv;
  clientUrls: string[];
}

function parseNodeEnv(value: string | undefined): NodeEnv {
  if (value === 'production' || value === 'test') return value;
  return 'development';
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 4000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT),
    nodeEnv: parseNodeEnv(env.NODE_ENV),
    clientUrls: (env.CLIENT_URL ?? 'http://localhost:5173')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
  };
}

export const config = loadConfig();
