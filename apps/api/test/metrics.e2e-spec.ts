import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Registry } from '@prometheus-io/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { validateEnv } from '../src/config/env.validation';
import { configureApp } from '../src/configure-app';
import { bearer, signToken } from './support/tokens';

type Labels = Record<string, string | number>;

/**
 * HTTP metrics through the real middleware and guard chain (ADR-0015). The registry is read
 * directly: the scrape listener is started by `main.ts` only, so no port is bound here. Every case
 * compares counts before and after its own requests, so cases do not depend on each other.
 */
describe('Metrics (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    assertTestDatabase(validateEnv(process.env).DATABASE_URL);
    token = await signToken();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('labels a request with its route template, never the raw id', async () => {
    const id = randomUUID();
    const labels = { method: 'GET', route: '/api/incidents/:id', status_code: '404' };
    const before = await requests(app, labels);

    await api(app).get(`/api/incidents/${id}`).set('Authorization', bearer(token)).expect(404);

    expect(await requests(app, labels)).toBe(before + 1);
    expect(await app.get(Registry).metrics()).not.toContain(id);
  });

  it('counts a request the authentication guard refused', async () => {
    const labels = { method: 'GET', route: '/api/zones', status_code: '401' };
    const before = await requests(app, labels);

    await api(app).get('/api/zones').expect(401);

    expect(await requests(app, labels)).toBe(before + 1);
  });

  it('labels a request no route matched as `unmatched`, without its path', async () => {
    const path = `/api/no-such-route-${randomUUID()}`;
    const labels = { method: 'GET', route: 'unmatched', status_code: '404' };
    const before = await requests(app, labels);

    await api(app).get(path).set('Authorization', bearer(token)).expect(404);

    expect(await requests(app, labels)).toBe(before + 1);
    expect(await app.get(Registry).metrics()).not.toContain(path);
  });

  it('leaves the probes out (ADR-0013)', async () => {
    await api(app).get('/api/health/live').expect(200);
    await api(app).get('/api/health/ready').expect(200);

    const routes = (await counted(app)).map(({ labels }) => String(labels.route));
    expect(routes.filter((route) => route.startsWith('/api/health'))).toEqual([]);
  });

  it('labels every series with the service and environment, as the log does', async () => {
    const text = await app.get(Registry).metrics();

    expect(text).toMatch(/^http_requests_total\{[^}]*service="occ-api"[^}]*\} \d+/m);
    expect(text).toMatch(/^process_start_time_seconds\{[^}]*env="test"[^}]*\} \d+/m);
  });
});

function api(target: INestApplication) {
  return request(target.getHttpServer());
}

async function counted(target: INestApplication) {
  return (await target.get(Registry).getSingleMetric('http_requests_total')!.get()).values;
}

/** The `http_requests_total` value for exactly these labels; 0 when the series does not exist. */
async function requests(target: INestApplication, labels: Labels): Promise<number> {
  const series = (await counted(target)).find(
    (value) =>
      Object.keys(labels).length === Object.keys(value.labels).length &&
      Object.entries(labels).every(([key, expected]) => value.labels[key] === expected),
  );
  return series?.value ?? 0;
}

/** Like the incidents suite: never write to a database whose name does not end in `_test`. */
function assertTestDatabase(databaseUrl: string): void {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run against database "${name}": e2e needs a *_test database.`);
  }
}
