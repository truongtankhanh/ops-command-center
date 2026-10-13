import { createServer, type AddressInfo } from 'node:net';
import type { INestApplication, Type } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { configureApp } from '../../src/configure-app';

/**
 * Helpers for e2e files that boot the whole app and read its state. They do not import
 * `AppModule`: loading it validates the environment, so a file that needs a particular environment
 * sets it first and loads the module itself (`telemetry-mqtt.e2e-spec.ts`, `telemetry.e2e-spec.ts`).
 */

/**
 * Boots `AppModule` as `main.ts` would, on a free port. `customise` is the place to override a
 * provider: `(builder) => builder.overrideProvider(TOKEN).useValue(double)`.
 */
export async function startApp(
  AppModule: Type<unknown>,
  customise: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
): Promise<INestApplication> {
  const moduleRef = await customise(Test.createTestingModule({ imports: [AppModule] })).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.listen(0);
  return app;
}

/** Polls `read` until `accept` likes it, or fails with the last value seen. */
export async function eventually<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}; last value: ${JSON.stringify(value)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Like the other suites: never write to a database whose name does not end in `_test`. */
export function assertTestDatabase(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run against database "${name}": e2e needs a *_test database.`);
  }
}

/** A port nothing listens on, for a dependency that must look unreachable. */
export async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
