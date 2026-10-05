/**
 * What the log must never carry, enforced in one place for every environment alike (ADR-0014).
 * The request serializers below are the first line: they let through named fields only. The rest
 * is defence in depth for whatever a call site logs later.
 */

/** Keys whose value is replaced wherever they appear in a structured log object. */
const SENSITIVE_KEYS = [
  'authorization',
  'Authorization',
  'cookie',
  'password',
  'secret',
  'client_secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'databaseUrl',
  'DATABASE_URL',
  'connectionString',
  // Personal data (ADR-0011): the IdP `sub`, logged as `userId`, is the only user identifier.
  'email',
  'displayName',
];

/** pino `redact` paths: each key at the top level, one level down, and in a `headers` object. */
export const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.headers.${key}`]),
  '["set-cookie"]',
  '*["set-cookie"]',
  '*.headers["set-cookie"]',
];

export const REDACTED = '[REDACTED]';

/**
 * Secrets that turn up inside strings: a message, an error's message or stack. The character
 * classes stop at `"` and `\`, so applied to a serialized JSON line they never cross a string's
 * boundary or an escape, and the line stays valid JSON.
 */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Credentials in a URL, as in a pg error carrying DATABASE_URL: keep the scheme only.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/"\\]+:[^\s@/"\\]+@/gi, `$1${REDACTED}@`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED}`],
  // A JWT anywhere, with or without the scheme: header and payload are base64url `eyJ…`.
  [/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED],
];

/** Masks the secrets in `text`. Used on every serialized log line, so it covers every field. */
export function scrubSecrets(text: string): string {
  let scrubbed = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

/** The request as `pino-std-serializers` hands it over, before ours picks fields. */
interface SerializedRequest {
  method: string;
  url: string;
}

/** Method and path only: no headers, no query string, no body. */
export function serializeRequest(req: SerializedRequest): { method: string; path: string } {
  return { method: req.method, path: pathOf(req.url) };
}

export function serializeResponse(res: { statusCode: number }): { statusCode: number } {
  return { statusCode: res.statusCode };
}

/** A URL without its query string, which may carry personal data. */
export function pathOf(url: string | undefined): string {
  return (url ?? '').split('?', 1)[0]!;
}
