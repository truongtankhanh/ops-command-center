import { startTestIssuer } from './support/test-issuer';

/**
 * Runs once, before any spec file is loaded. `AppModule` validates `OIDC_*` at import, so the
 * test issuer has to exist first; Jest copies `process.env` into each test environment afterwards.
 */
export default async function globalSetup(): Promise<void> {
  globalThis.__E2E_ISSUER__ = await startTestIssuer();
}
