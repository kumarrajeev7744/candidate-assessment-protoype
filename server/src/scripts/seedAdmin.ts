import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Admin } from '../models/index.js';
import { seedAdmin, validateAdminSeedInput } from '../services/adminSeedService.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  // Validate before connecting so configuration mistakes fail fast.
  validateAdminSeedInput(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  await connectDatabase(config.mongodbUri);
  await Admin.init();
  const outcome = await seedAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  logger.info(
    outcome.status === 'created'
      ? 'Admin account created'
      : 'Admin account already exists; password left unchanged',
    { email: outcome.email },
  );
}

main()
  .catch((err: unknown) => {
    logger.error('Admin seed failed', { error: (err as Error).message });
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
