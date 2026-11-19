import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const SERVER_SELECTION_TIMEOUT_MS = 10_000;

/**
 * Returns a credential-free description of a MongoDB URI (scheme, hosts and database)
 * that is safe to log.
 */
export function describeMongoUri(uri: string): string {
  const match = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(uri);
  if (!match) return '<invalid MongoDB URI>';
  const [, scheme, hosts, dbName] = match;
  return `${scheme}://${hosts}/${dbName ?? ''}`;
}

export function validateMongoUri(uri: string | undefined): string {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to server/.env (see server/.env.example).');
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }
  return uri;
}

let listenersRegistered = false;
let closingIntentionally = false;

function registerConnectionListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;
  mongoose.connection.on('disconnected', () => {
    if (!closingIntentionally) logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err: Error) =>
    logger.error('MongoDB connection error', { error: err.message }),
  );
}

/** Connects Mongoose to MongoDB. Throws if the URI is missing/invalid or the server is unreachable. */
export async function connectDatabase(
  uri: string | undefined,
  options: { serverSelectionTimeoutMS?: number } = {},
): Promise<typeof mongoose> {
  const validUri = validateMongoUri(uri);
  mongoose.set('strictQuery', true);
  registerConnectionListeners();
  try {
    await mongoose.connect(validUri, {
      serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? SERVER_SELECTION_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(
      `Failed to connect to MongoDB at ${describeMongoUri(validUri)}: ${(err as Error).message}`,
      { cause: err },
    );
  }
  logger.info('MongoDB connected', {
    target: describeMongoUri(validUri),
    database: mongoose.connection.name,
  });
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) return;
  closingIntentionally = true;
  try {
    await mongoose.disconnect();
  } finally {
    closingIntentionally = false;
  }
  logger.info('MongoDB connection closed');
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
