// Import this first, before anything that loads `AppModule`: `setup-env.ts` turns rate limits off
// for every e2e file, and `ConfigModule` validates the environment once, when `AppModule` loads.
process.env.RATE_LIMIT_ENABLED = 'true';

export {};
