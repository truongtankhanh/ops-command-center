import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestId } from './request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * What an incoming id may look like: nginx's `$request_id` (32 hex digits), a UUID, or another
 * proxy's id. Anything else is replaced, so a client cannot write arbitrary text into the log.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Gives every request its correlation id (ADR-0014): the one nginx set, or a new one. Mounted with
 * `app.use` before anything else, so the whole request runs inside the id's context. The id goes
 * back in the response header, for a client or support to quote.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const requestId =
    typeof incoming === 'string' && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  // pino-http keeps an existing `req.id`, so the request log uses this id too.
  (req as Request & { id?: string }).id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestId(requestId, next);
}
