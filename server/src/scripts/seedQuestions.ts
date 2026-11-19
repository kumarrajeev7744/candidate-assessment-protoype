import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { Question } from '../models/index.js';
import { questionSeedData } from '../seed/questionSeedData.js';
import { seedQuestions } from '../services/questionSeedService.js';
import { logger } from '../utils/logger.js';

async function main(): Promise<void> {
  await connectDatabase(config.mongodbUri);
  await Question.init(); // make sure the unique questionNumber index exists
  const result = await seedQuestions(questionSeedData);
  const activeCount = await Question.countDocuments({ isActive: true });
  logger.info('Question seed complete', { ...result, activeQuestions: activeCount });
}

main()
  .catch((err: unknown) => {
    logger.error('Question seed failed', { error: (err as Error).message });
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
