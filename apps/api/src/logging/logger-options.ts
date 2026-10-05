import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import type { Params } from 'nestjs-pino';
import pino, { type Logger } from 'pino';
import type { RequestWithUser } from '../auth/auth.decorators';
import type { Env } from '../config/env.validation';
import {
  pathOf,
  REDACT_PATHS,
  REDACTED,
  scrubSecrets,
  serializeRequest,
  serializeResponse,
} from './redaction';
import { currentRequestId } from './request-context';

/** Also the `service` label on every metric (ADR-0015), so logs and metrics filter alike. */
export const SERVICE = 'occ-api';

/**
 * Probes are polled every few seconds; ADR-0013 keeps them out of the log, and out of the HTTP
 * metrics too (ADR-0015).
 */
export const UNLOGGED_PATHS = new Set(['/api/health/live', '/api/health/ready']);

/** apps/api/package.json, from src/logging or dist/logging alike. */
const VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

type LoggingEnv = Pick<Env, 'NODE_ENV' | 'LOG_LEVEL' | 'DEPLOYMENT_ENV'>;

/**
 * The one logger configuration (ADR-0014). Every environment writes the same JSON objects;
 * development only renders them through `pino-pretty`, a devDependency the image does not have.
 * Staging and production share every line of this, so staging shows production's output.
 */
export function loggerParams(env: LoggingEnv): Params {
  const development = env.NODE_ENV === 'development';
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: {
        service: SERVICE,
        env: env.DEPLOYMENT_ENV,
        version: VERSION,
        pid: process.pid,
        hostname: hostname(),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      // Synchronous stdout: an async destination can lose the last lines before a crash.
      ...(development
        ? {
            transport: {
              // Resolved from here: under pnpm, pino cannot see a package it does not depend on.
              target: require.resolve('pino-pretty'),
              options: {
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname,service,env,version,context',
                messageFormat: '{if context}[{context}] {end}{msg}',
              },
            },
          }
        : { formatters: { level: (label: string) => ({ level: label }) } }),
      redact: { paths: REDACT_PATHS, censor: REDACTED },
      // Last step before a line is written: catches secrets inside messages and stacks too.
      hooks: { streamWrite: scrubSecrets },
      mixin: requestIdMixin,

      // The request log: one `info` line per response, named fields only.
      serializers: { req: serializeRequest, res: serializeResponse },
      quietReqLogger: true,
      customAttributeKeys: { reqId: 'requestId' },
      // `requestIdMiddleware` has set `req.id` already; this covers an app built without it.
      genReqId: (req) => (req as IncomingMessage & { id?: string }).id ?? randomUUID(),
      customProps: (req) => {
        const userId = (req as unknown as RequestWithUser).user?.subject;
        return userId ? { userId } : {};
      },
      autoLogging: { ignore: (req) => UNLOGGED_PATHS.has(pathOf(originalUrl(req))) },
      // A 5xx is logged once, with its stack, by `ApiExceptionFilter`; this line is the trail.
      customLogLevel: () => 'info',
      customErrorObject: (_req, _res, _error, value: Record<string, unknown>) => ({
        res: value.res,
        responseTime: value.responseTime,
      }),
    },
  };
}

/**
 * Adds `requestId` to lines written outside the request logger: in a job run, an outbox delivery,
 * or by a logger created before the request. Skipped where the request logger already binds it,
 * so a line never carries the key twice.
 */
function requestIdMixin(_merge: object, _level: number, logger: Logger): object {
  const requestId = currentRequestId();
  if (!requestId) return {};
  const bindings = (logger as unknown as Record<symbol, string | undefined>)[
    pino.symbols.chindingsSym
  ];
  return bindings?.includes('"requestId":') ? {} : { requestId };
}

function originalUrl(req: IncomingMessage): string | undefined {
  return (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url;
}
