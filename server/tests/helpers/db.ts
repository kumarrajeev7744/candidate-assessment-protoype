import { afterAll, afterEach, beforeAll } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';
import * as models from '../../src/models/index.js';

/**
 * Starts an isolated in-memory MongoDB (single-node replica set, so transactions work like on
 * Atlas) for the current test file and cleans data between tests.
 */
export function useTestDatabase(): void {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    await connectDatabase(replSet.getUri('test'));
    // Build all indexes (and collections) up front: unique constraints are enforced and
    // collections exist before transactions use them.
    const all: mongoose.Model<never>[] = [
      models.Admin,
      models.Candidate,
      models.Invitation,
      models.Question,
      models.Response,
      models.ShareLink,
    ] as never;
    for (const model of all) {
      await model.createCollection().catch(() => undefined);
      await model.init();
    }
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectDatabase();
    await replSet?.stop();
  });
}
