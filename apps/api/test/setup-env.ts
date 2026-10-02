// Jest `setupFiles`: runs before each e2e file imports AppModule, whose ConfigModule validates once,
// at import. A real env var beats `.env.test`, so these hold for every run.
process.env.SEED_ON_BOOT = 'true';
process.env.SIMULATOR_ENABLED = 'false';

export {};
