import { describe, it, expect, afterEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  connectDatabase,
  describeMongoUri,
  disconnectDatabase,
  isDatabaseConnected,
  validateMongoUri,
} from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';

describe('MongoDB configuration', () => {
  it('reads MONGODB_URI from the environment', () => {
    expect(loadConfig({ MONGODB_URI: ' mongodb://localhost/db ' }).mongodbUri).toBe('mongodb://localhost/db');
    expect(loadConfig({}).mongodbUri).toBeUndefined();
  });

  it('rejects a missing URI with a helpful message', () => {
    expect(() => validateMongoUri(undefined)).toThrow(/MONGODB_URI is not set/);
    expect(() => validateMongoUri('')).toThrow(/MONGODB_URI is not set/);
  });

  it('rejects a URI with the wrong scheme', () => {
    expect(() => validateMongoUri('http://example.com')).toThrow(/must start with mongodb/);
  });

  it('accepts mongodb:// and mongodb+srv:// URIs', () => {
    expect(validateMongoUri('mongodb://localhost:27017/db')).toBe('mongodb://localhost:27017/db');
    expect(validateMongoUri('mongodb+srv://u:p@cluster0.abc.mongodb.net/db')).toContain('mongodb+srv');
  });

  it('removes credentials when describing a URI for logs', () => {
    const described = describeMongoUri(
      'mongodb+srv://admin:S3cr3t!@cluster0.abc.mongodb.net/candidate_assessment?retryWrites=true',
    );
    expect(described).toBe('mongodb+srv://cluster0.abc.mongodb.net/candidate_assessment');
    expect(described).not.toContain('S3cr3t');
    expect(described).not.toContain('admin');
  });
});

describe('connectDatabase', () => {
  afterEach(async () => {
    await disconnectDatabase();
  });

  it('connects to and disconnects from a MongoDB server', async () => {
    const mongod = await MongoMemoryServer.create();
    try {
      await connectDatabase(mongod.getUri('conn_test'));
      expect(isDatabaseConnected()).toBe(true);
      await disconnectDatabase();
      expect(isDatabaseConnected()).toBe(false);
    } finally {
      await mongod.stop();
    }
  });

  it('fails with a credential-free error when the server is unreachable', async () => {
    const err = (await connectDatabase('mongodb://user:topsecret@127.0.0.1:1/db', {
      serverSelectionTimeoutMS: 500,
    }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^Failed to connect to MongoDB at mongodb:\/\/127\.0\.0\.1:1\/db:/);
    expect(err.message).not.toContain('topsecret');
    expect(isDatabaseConnected()).toBe(false);
  });
});
