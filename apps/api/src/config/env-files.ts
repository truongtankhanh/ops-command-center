import { resolve } from 'node:path';

// Anchored to apps/api, not process.cwd(): src/ and dist/ both sit one level below it.
const API_ROOT = resolve(__dirname, '..', '..');

/** The env file for this process. Tests never read the developer's `.env`. */
export function envFilePath(nodeEnv = process.env.NODE_ENV): string {
  return resolve(API_ROOT, nodeEnv === 'test' ? '.env.test' : '.env');
}
