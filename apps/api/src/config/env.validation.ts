import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['true', '1', 'yes'].includes(value.toLowerCase()) : value;

/** pino's levels, lowest last. Nest's `verbose` is `trace` (ADR-0014). */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEPLOYMENT_ENVS = ['local', 'test', 'demo', 'staging', 'production'] as const;
export type DeploymentEnv = (typeof DEPLOYMENT_ENVS)[number];

const DEFAULT_LOG_LEVELS: Readonly<Record<Env['NODE_ENV'], LogLevel>> = {
  development: 'debug',
  test: 'warn',
  production: 'info',
};

/**
 * Every environment variable the API reads, with its rules and defaults.
 * The API refuses to start when this does not validate.
 */
export class Env {
  /** Required: a forgotten value fails boot instead of quietly running as development. */
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production';

  /** Serve Swagger UI and the raw spec. Unset: on everywhere except production (ADR-0005). */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  API_DOCS_ENABLED?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  /**
   * Port of the Prometheus scrape endpoint, `GET /metrics` (ADR-0015). Served apart from `PORT`, so
   * nginx never proxies it; only the network decides who reaches it.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  METRICS_PORT = 9464;

  /**
   * Proxies in front of the API whose `X-Forwarded-For` entry is trusted for `req.ip` (ADR-0012).
   * 1 = the console's nginx, which overwrites the header. Keep 1 even with a load balancer in front:
   * nginx resolves that with `real-ip.conf`. 0 only if the API port is reachable without nginx.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS = 1;

  /** Per-user rate limits (ADR-0012). Off only for tests and local work; production refuses it. */
  @Transform(toBoolean)
  @IsBoolean()
  RATE_LIMIT_ENABLED = true;

  /** PostgreSQL connection string; the only secret the API reads. */
  @IsUrl({ protocols: ['postgres', 'postgresql'], require_protocol: true, require_tld: false })
  DATABASE_URL: string;

  /**
   * The `iss` every access token must carry: the issuer URL as the browser reaches it. Required in
   * every environment; there is no way to run the API without authentication (ADR-0010).
   */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  OIDC_ISSUER: string;

  /** Where the API fetches the issuer's signing keys; may be an internal address. */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  OIDC_JWKS_URL: string;

  /** The `aud` value that marks a token as meant for this API. */
  @IsString()
  @IsNotEmpty()
  OIDC_AUDIENCE: string;

  /** Unset: on, except in production (see `applyEnvironmentDefaults`). */
  @Transform(toBoolean)
  @IsBoolean()
  SEED_ON_BOOT: boolean;

  @Transform(toBoolean)
  @IsBoolean()
  SIMULATOR_ENABLED = false;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  SIMULATOR_INTERVAL_MS = 8000;

  /** Unset: `mock`, except in production, which has no default. */
  @IsIn(['mock', 'mediamtx'], {
    message: '$property must be mock or mediamtx; production has no default',
  })
  CAMERA_SOURCE: 'mock' | 'mediamtx';

  @ValidateIf((env: Env) => env.CAMERA_SOURCE === 'mediamtx')
  @IsUrl({ require_tld: false })
  MEDIAMTX_HLS_URL?: string;

  @ValidateIf((env: Env) => env.CAMERA_SOURCE === 'mediamtx')
  @IsUrl({ require_tld: false })
  MEDIAMTX_WEBRTC_URL?: string;

  @IsOptional()
  @IsIn(['hls', 'webrtc'])
  MEDIAMTX_PROTOCOL: 'hls' | 'webrtc' = 'hls';

  /** Lets production run demo behaviour (mock cameras, seeding). Only the Compose demo sets it. */
  @Transform(toBoolean)
  @IsBoolean()
  DEMO_MODE = false;

  /**
   * Lowest level logged at boot; `log-level` raises it for a while at runtime (ADR-0014).
   * Unset: `debug` in development, `warn` in test, `info` in production.
   */
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: LogLevel;

  /**
   * Where this process runs, stamped on every log line as `env`. A label only: it changes no
   * behaviour (ADR-0014). Unset: `local` in development, `test` in test; production has no default.
   */
  @IsIn(DEPLOYMENT_ENVS, {
    message: `$property must be one of ${DEPLOYMENT_ENVS.join(', ')}; production has no default`,
  })
  DEPLOYMENT_ENV: DeploymentEnv;
}

/** Defaults that depend on `NODE_ENV`, which a field initializer cannot see. */
function applyEnvironmentDefaults(env: Env): void {
  const production = env.NODE_ENV === 'production';
  env.SEED_ON_BOOT ??= !production;
  if (!production) env.CAMERA_SOURCE ??= 'mock';
  env.LOG_LEVEL ??= DEFAULT_LOG_LEVELS[env.NODE_ENV];
  // Production has none: a staging deploy that forgot it must not be tagged `production`.
  if (!production) env.DEPLOYMENT_ENV ??= env.NODE_ENV === 'test' ? 'test' : 'local';
}

/** Production refuses demo behaviour unless `DEMO_MODE` opts in. */
function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production' || env.DEMO_MODE) return [];
  const problems: string[] = [];
  if (env.CAMERA_SOURCE === 'mock') {
    problems.push('CAMERA_SOURCE: mock needs DEMO_MODE=true in production');
  }
  if (env.SEED_ON_BOOT) problems.push('SEED_ON_BOOT: true needs DEMO_MODE=true in production');
  // Passwords and tokens travel through the issuer's pages; plain HTTP is for the demo only.
  if (/^http:/i.test(env.OIDC_ISSUER ?? '')) {
    problems.push('OIDC_ISSUER: http needs DEMO_MODE=true in production; use https');
  }
  return problems;
}

/** Not demo behaviour: the demo enforces production's limits, so `DEMO_MODE` does not lift it. */
function rateLimitProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production' || env.RATE_LIMIT_ENABLED !== false) return [];
  return ['RATE_LIMIT_ENABLED: false is not allowed in production'];
}

/** The scrape endpoint has its own listener; sharing the API's port would fail at boot anyway. */
function metricsProblems(env: Env): string[] {
  return env.METRICS_PORT === env.PORT ? ['METRICS_PORT: must differ from PORT'] : [];
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw);
  applyEnvironmentDefaults(env);
  const problems = [
    ...validateSync(env, { skipMissingProperties: false }).map(
      (e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
    ),
    ...productionProblems(env),
    ...rateLimitProblems(env),
    ...metricsProblems(env),
  ];
  if (problems.length > 0) {
    const details = problems.map((problem) => `  - ${problem}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
