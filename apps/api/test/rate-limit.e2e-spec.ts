// First: rate limits must be on before `AppModule` loads (see the file for why).
import './support/enable-rate-limits';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validateEnv } from '../src/config/env.validation';
import { configureApp } from '../src/configure-app';
import {
  REPORT_INCIDENT_RATE_LIMIT,
  TRANSITION_INCIDENT_RATE_LIMIT,
} from '../src/rate-limit/rate-limits';
import { bearer, signToken } from './support/tokens';

const REPORT_LIMIT = REPORT_INCIDENT_RATE_LIMIT.limit;

/**
 * Rate limiting through the real guard chain and the PostgreSQL storage (ADR-0012), on two
 * application instances sharing one database, as two API replicas would. Every case signs in as
 * its own user, so no case inherits another's counters. Writes use an invalid body: the throttler
 * counts them, then validation answers 400, so nothing is created.
 */
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  let appB: INestApplication;

  beforeAll(async () => {
    assertTestDatabase(validateEnv(process.env).DATABASE_URL);
    app = await startApp();
    appB = await startApp();
  });

  afterAll(async () => {
    await appB?.close();
    await app?.close();
  });

  it('refuses the request after the limit with the API error body and Retry-After', async () => {
    const token = await newUserToken();

    for (let i = 1; i <= REPORT_LIMIT; i++) {
      const res = await reportInvalid(app, token).expect(400);
      expect(res.headers['x-ratelimit-limit']).toBe(String(REPORT_LIMIT));
      expect(res.headers['x-ratelimit-remaining']).toBe(String(REPORT_LIMIT - i));
    }
    const refused = await reportInvalid(app, token).expect(429);

    expect(refused.body).toEqual({
      statusCode: 429,
      error: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Try again shortly.',
      path: '/api/incidents',
      timestamp: expect.any(String),
    });
    const retryAfter = Number(refused.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(REPORT_INCIDENT_RATE_LIMIT.ttl / 1000);
  });

  it('counts once across instances, not once per instance', async () => {
    const token = await newUserToken();

    for (let i = 0; i < REPORT_LIMIT; i++) {
      await reportInvalid(i % 2 === 0 ? app : appB, token).expect(400);
    }

    await reportInvalid(app, token).expect(429);
    await reportInvalid(appB, token).expect(429);
  });

  it('counts concurrent requests exactly', async () => {
    const token = await newUserToken();

    const responses = await Promise.all(
      Array.from({ length: REPORT_LIMIT + 5 }, (_, i) => reportInvalid(i % 2 ? app : appB, token)),
    );

    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 400)).toHaveLength(REPORT_LIMIT);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });

  it('keeps a bucket per user and per route', async () => {
    const blocked = await newUserToken();
    await exhaustReport(blocked);

    // Another user is unaffected.
    await reportInvalid(app, await newUserToken()).expect(400);

    // The same user can still use another route, which has its own limit.
    const acknowledge = await request(app.getHttpServer())
      .post(`/api/incidents/${randomUUID()}/acknowledge`)
      .set('Authorization', bearer(blocked))
      .send({})
      .expect(404);
    expect(acknowledge.headers['x-ratelimit-limit']).toBe(
      String(TRANSITION_INCIDENT_RATE_LIMIT.limit),
    );
  });

  it('ignores X-Forwarded-For: a client cannot reset its count by changing it', async () => {
    const token = await newUserToken();

    for (let i = 0; i < REPORT_LIMIT; i++) {
      await reportInvalid(app, token).set('X-Forwarded-For', `198.51.100.${i}`).expect(400);
    }

    await reportInvalid(app, token).set('X-Forwarded-For', '203.0.113.7').expect(429);
  });

  it('never throttles the health probes', async () => {
    for (const path of ['/api/health/live', '/api/health/ready']) {
      for (let i = 0; i < 150; i++) {
        const res = await request(app.getHttpServer()).get(path).expect(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
      }
    }
  });

  it('answers 401 to a request without a token, before counting anything', async () => {
    const before = await counterRows(app);

    await request(app.getHttpServer()).post('/api/incidents').send({}).expect(401);

    expect(await counterRows(app)).toBe(before);
  });

  it('starts a new window once the old one is over', async () => {
    const token = await newUserToken();
    const keysBefore = await counterKeys(app);
    await exhaustReport(token);
    const [key, ...others] = [...(await counterKeys(app))].filter((k) => !keysBefore.has(k));
    expect(others).toHaveLength(0);

    // Move this user's window and block into the past instead of waiting a minute.
    await app.get(DataSource).query(
      `UPDATE "throttler_hit"
            SET "expires_at" = now() - interval '1 second',
                "blocked_until" = now() - interval '1 second'
          WHERE "key" = $1`,
      [key],
    );

    const res = await reportInvalid(app, token).expect(400);
    expect(res.headers['x-ratelimit-remaining']).toBe(String(REPORT_LIMIT - 1));
  });

  /** Sends the limit's worth of reports, then checks the next one is refused. */
  async function exhaustReport(token: string): Promise<void> {
    for (let i = 0; i < REPORT_LIMIT; i++) await reportInvalid(app, token).expect(400);
    await reportInvalid(app, token).expect(429);
  }
});

async function startApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  // Listening already, so supertest reuses this address instead of opening and closing a server
  // around every request (hundreds here, some of them concurrent).
  await app.listen(0);
  return app;
}

/** An operator token for a user no other case uses. */
function newUserToken(): Promise<string> {
  return signToken({ sub: `rate-limit-${randomUUID()}` });
}

/** `POST /api/incidents` with an empty body: counted by the throttler, then refused with 400. */
function reportInvalid(target: INestApplication, token: string): request.Test {
  return request(target.getHttpServer())
    .post('/api/incidents')
    .set('Authorization', bearer(token))
    .send({});
}

async function counterKeys(target: INestApplication): Promise<Set<string>> {
  const rows: { key: string }[] = await target
    .get(DataSource)
    .query(`SELECT "key" FROM "throttler_hit"`);
  return new Set(rows.map((row) => row.key));
}

async function counterRows(target: INestApplication): Promise<number> {
  return (await counterKeys(target)).size;
}

/** Like the incidents suite: never write to a database whose name does not end in `_test`. */
function assertTestDatabase(databaseUrl: string): void {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run against database "${name}": e2e needs a *_test database.`);
  }
}
