import { afterAll, afterEach, beforeAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/database.js';
import * as models from '../../src/models/index.js';

/** Starts an isolated in-memory MongoDB for the current test file and cleans data between tests. */
export function useTestDatabase(): void {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDatabase(mongod.getUri('test'));
    // Build all indexes up front so unique constraints are enforced in tests.
    await Promise.all(
      [models.Admin, models.Candidate, models.Invitation, models.Question, models.Response, models.ShareLink].map(
        (m) => m.init(),
      ),
    );
  });

  afterEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongod?.stop();
  });
}
