import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import type { StoreApi } from 'zustand';

/** A fresh client per test, without retries, so a failing request fails the test at once. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** `renderHook`'s `wrapper`: the provider around the hook under test. */
export function queryWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/**
 * `render()` inside a `QueryClientProvider`, the way the existing tests wrap it. Returns the client
 * to seed or inspect the cache. A `rerender` must wrap the provider again.
 */
export function renderWithQueryClient(
  ui: ReactElement,
  client = createTestQueryClient(),
): RenderResult & { client: QueryClient } {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** Puts a store back to its initial state (actions included), so no state leaks between cases. */
export function resetStore<T>(store: Pick<StoreApi<T>, 'setState' | 'getInitialState'>): void {
  store.setState(store.getInitialState(), true);
}
