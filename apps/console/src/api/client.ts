import type { ApiError } from '@occ/contracts';
import { getAccessToken, renewSession } from '../auth/session';

/** An API failure with the server's message, ready to show to an operator. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Query retry policy: a 4xx will not change on retry; network errors and 5xx get two more tries. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status < 500) return false;
  return failureCount < 2;
}

async function request<T>(path: string, init?: RequestInit, replayed = false): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    // Last, so no caller can replace the bearer token.
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  // The API checks the token before anything else, so a 401 request changed nothing and can be
  // sent once more with a renewed token, whatever its method (ADR-0010).
  if (response.status === 401 && token && !replayed && (await renewSession())) {
    return request<T>(path, init, true);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    throw new ApiRequestError(response.status, message ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), headers }),
};
