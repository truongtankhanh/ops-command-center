import { EventEmitter } from 'node:events';
import { Registry } from '@prometheus-io/client';
import type { Request, Response } from 'express';
import { HttpMetrics, routeOf, UNMATCHED_ROUTE } from './http-metrics.middleware';

interface Exchange {
  req: Request;
  res: Response;
  next: jest.Mock;
}

/** What Express hands the middleware: no route yet, which routing sets later. */
function exchange(method: string, originalUrl: string): Exchange {
  const req = { method, originalUrl, baseUrl: '' } as unknown as Request;
  const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
  return { req, res, next: jest.fn() };
}

/** Routing matched `path`, and the response finished with `statusCode`. */
function finish({ req, res }: Exchange, statusCode: number, path?: string): void {
  if (path) (req as unknown as { route: { path: string } }).route = { path };
  res.statusCode = statusCode;
  res.emit('finish');
}

async function values(registry: Registry, name: string) {
  return (await registry.getSingleMetric(name)!.get()).values;
}

describe('routeOf', () => {
  it('is the matched template, never the raw path', () => {
    const req = {
      baseUrl: '',
      originalUrl: '/api/incidents/0b7e8c2a-4c1e-4a43-9a52-2f7d1c3e9b10',
      route: { path: '/api/incidents/:id' },
    } as unknown as Request;

    expect(routeOf(req)).toBe('/api/incidents/:id');
  });

  it('prefixes the mount path of a sub-router', () => {
    const req = { baseUrl: '/api', route: { path: '/zones' } } as unknown as Request;

    expect(routeOf(req)).toBe('/api/zones');
  });

  it('is `unmatched` when no route matched', () => {
    const req = { baseUrl: '', originalUrl: '/api/no-such-thing' } as unknown as Request;

    expect(routeOf(req)).toBe(UNMATCHED_ROUTE);
  });

  it("is `unmatched` for Nest's own 404 catch-all under the global prefix", () => {
    const req = {
      baseUrl: '/api',
      originalUrl: '/api/no-such-thing',
      route: { path: '*path' },
    } as unknown as Request;

    expect(routeOf(req)).toBe(UNMATCHED_ROUTE);
  });
});

describe('HttpMetrics', () => {
  let registry: Registry;
  let metrics: HttpMetrics;

  beforeEach(() => {
    registry = new Registry();
    metrics = new HttpMetrics(registry);
  });

  it('records one request and one duration, with the same labels, when the response finishes', async () => {
    const call = exchange('GET', '/api/incidents/0b7e8c2a-4c1e-4a43-9a52-2f7d1c3e9b10');

    metrics.middleware(call.req, call.res, call.next);
    expect(call.next).toHaveBeenCalledTimes(1);
    expect(await values(registry, 'http_requests_total')).toEqual([]);

    finish(call, 404, '/api/incidents/:id');

    const labels = { method: 'GET', route: '/api/incidents/:id', status_code: '404' };
    expect(await values(registry, 'http_requests_total')).toEqual([{ labels, value: 1 }]);
    const durations = await values(registry, 'http_request_duration_seconds');
    expect(durations).toContainEqual(
      expect.objectContaining({
        labels,
        metricName: 'http_request_duration_seconds_count',
        value: 1,
      }),
    );
  });

  it('records a request that no route matched as `unmatched`', async () => {
    const call = exchange('GET', '/api/0b7e8c2a-4c1e-4a43-9a52-2f7d1c3e9b10');

    metrics.middleware(call.req, call.res, call.next);
    finish(call, 404);

    expect(await values(registry, 'http_requests_total')).toEqual([
      { labels: { method: 'GET', route: UNMATCHED_ROUTE, status_code: '404' }, value: 1 },
    ]);
  });

  it('records a request a guard refused, under its route', async () => {
    const call = exchange('POST', '/api/incidents');

    metrics.middleware(call.req, call.res, call.next);
    finish(call, 429, '/api/incidents');

    expect(await values(registry, 'http_requests_total')).toEqual([
      { labels: { method: 'POST', route: '/api/incidents', status_code: '429' }, value: 1 },
    ]);
  });

  it.each(['/api/health/live', '/api/health/ready', '/api/health/ready?verbose=1'])(
    'leaves the probe %s out, as the request log does (ADR-0013)',
    async (url) => {
      const call = exchange('GET', url);

      metrics.middleware(call.req, call.res, call.next);
      finish(call, 200, url.split('?')[0]);

      expect(call.next).toHaveBeenCalledTimes(1);
      expect(await values(registry, 'http_requests_total')).toEqual([]);
      expect(await values(registry, 'http_request_duration_seconds')).toEqual([]);
    },
  );

  it('records nothing for a response that never finished', async () => {
    const call = exchange('GET', '/api/zones');

    metrics.middleware(call.req, call.res, call.next);
    call.res.emit('close');

    expect(await values(registry, 'http_requests_total')).toEqual([]);
  });
});
