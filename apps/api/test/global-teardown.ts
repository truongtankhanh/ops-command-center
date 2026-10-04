import type {} from './support/test-issuer'; // the `__E2E_ISSUER__` global

/** Closes the test issuer once every spec has closed its apps. */
export default async function globalTeardown(): Promise<void> {
  await globalThis.__E2E_ISSUER__?.close();
}
