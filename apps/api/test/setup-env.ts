// Jest `setupFiles`: runs before each e2e file imports AppModule, whose ConfigModule validates once,
// at import. A real env var beats `.env.test`, so these hold for every run.
process.env.SEED_ON_BOOT = 'true';
process.env.SIMULATOR_ENABLED = 'false';
// Suites send more than a limit's worth of writes as one user (ADR-0012). `rate-limit.e2e-spec.ts`
// turns them back on for itself (`support/enable-rate-limits.ts`).
process.env.RATE_LIMIT_ENABLED = 'false';

export {};
