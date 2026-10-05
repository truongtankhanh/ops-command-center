import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry } from '@prometheus-io/client';
import type { NextFunction, Request, Response } from 'express';
import { UNLOGGED_PATHS } from '../logging/logger-options';
import { pathOf } from '../logging/redaction';

type HttpLabel = 'method' | 'route' | 'status_code';

const LABEL_NAMES: readonly HttpLabel[] = ['method', 'route', 'status_code'];

/** Up to `statement_timeout` (15 s): a request the database bounds never lands only in `+Inf`. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15];

/** The `route` of a request no route matched. Its raw path is unbounded, so never a label. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Nest answers 404 under the global prefix from a catch-all route of its own
 * (`router.all('*path')`, `ExpressAdapter.setNotFoundHandler`): a match, but not one of ours.
 */
const NEST_NOT_FOUND_PATH = '*path';

/**
 * HTTP RED metrics (ADR-0015): rate and errors from `http_requests_total`, duration from
 * `http_request_duration_seconds`, both by method, route template and status code. Errors are
 * `status_code=~"5.."` at query time, not a counter of their own.
 */
@Injectable()
export class HttpMetrics {
  private readonly requests: Counter<HttpLabel>;
  private readonly duration: Histogram<HttpLabel>;

  constructor(registry: Registry) {
    this.requests = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests answered, by method, route template and status code.',
      labelNames: LABEL_NAMES,
      registers: [registry],
    });
    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Time from receiving an HTTP request to finishing its response.',
      labelNames: LABEL_NAMES,
      buckets: DURATION_BUCKETS,
      registers: [registry],
    });
  }

  /**
   * Mounted with `app.use` ahead of routing, so it also counts requests that guards refuse
   * (401, 403, 429) and those no route matches. Probes are left out, as in the log (ADR-0013).
   * A request whose client went away before the response finished is not recorded.
   */
  readonly middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (UNLOGGED_PATHS.has(pathOf(req.originalUrl))) {
      next();
      return;
    }
    const end = this.duration.startTimer();
    res.once('finish', () => {
      const labels = {
        method: req.method,
        route: routeOf(req),
        status_code: String(res.statusCode),
      };
      end(labels);
      this.requests.inc(labels);
    });
    next();
  };
}

/** The matched route's template (`/api/incidents/:id`), read once the response is done. */
export function routeOf(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' && path !== NEST_NOT_FOUND_PATH
    ? req.baseUrl + path
    : UNMATCHED_ROUTE;
}
