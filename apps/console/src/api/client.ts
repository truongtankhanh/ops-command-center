import type { ApiError } from '@occ/contracts';

/** An API failure with the server's message, ready to show to an operator. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    throw new ApiRequestError(response.status, message ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
};
