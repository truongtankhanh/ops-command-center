import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import axe from 'axe-core';
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

/**
 * Fails with every axe violation found under `root` (WCAG 2.x A / AA and axe's best practices).
 * `root` defaults to `document.body`, so portals (`Dialog`) are included.
 *
 * Rules that cannot work here are off:
 * - `color-contrast` always: jsdom has no layout or computed colours to measure, and the tokens'
 *   contrast is already proven by `scripts/contrast.ts` in lint.
 * - `region` unless `screen`: a component rendered on its own has no landmarks around it. A test
 *   that renders the whole console passes `screen: true`.
 *
 * `disable` turns off more rules for one case; say why next to the call.
 */
export async function expectNoAxeViolations(
  root: Element = document.body,
  { screen = false, disable = [] }: { screen?: boolean; disable?: string[] } = {},
): Promise<void> {
  const off = ['color-contrast', ...(screen ? [] : ['region']), ...disable];
  const { violations } = await axe.run(root, {
    rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])),
  });
  if (violations.length === 0) return;
  const report = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n` +
        violation.nodes.map((node) => `  at ${node.target.join(' ')}`).join('\n') +
        `\n  ${violation.helpUrl}`,
    )
    .join('\n\n');
  throw new Error(`${violations.length} axe violation(s):\n\n${report}`);
}
