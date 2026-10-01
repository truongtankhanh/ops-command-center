import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { typeormOptions } from './typeorm-options';

/** Entry point for the TypeORM CLI (`pnpm migration:generate`, `pnpm migration:run`). */
export default new DataSource(
  typeormOptions(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:15432/ops'),
);
