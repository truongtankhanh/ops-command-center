import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { envFilePath } from '../config/env-files';
import { validateEnv } from '../config/env.validation';
import { typeormOptions } from './typeorm-options';

// No Nest container here: load the same env file and run the same validation as the app,
// so a missing or malformed DATABASE_URL fails the same way. A real env var still wins.
try {
  process.loadEnvFile(envFilePath());
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

/** Entry point for the TypeORM CLI (`pnpm migration:generate`, `pnpm migration:run`). */
export default new DataSource(typeormOptions(validateEnv(process.env).DATABASE_URL));
