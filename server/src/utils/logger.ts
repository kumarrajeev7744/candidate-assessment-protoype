type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...meta });
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Minimal structured (JSON) logger; output is picked up by CloudWatch on App Runner. */
export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
