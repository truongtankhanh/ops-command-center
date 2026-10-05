import type { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.validation';
import { isApiDocsEnabled } from './configure-app';

/** Only the two keys the policy reads, so the test runner's own environment cannot leak in. */
function configWith(env: Pick<Env, 'NODE_ENV' | 'API_DOCS_ENABLED'>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => env[key as keyof typeof env] } as ConfigService<Env, true>;
}

// The exposure policy of ADR-0005: production serves no docs unless a deploy opts in.
describe('isApiDocsEnabled', () => {
  it.each([
    ['production', undefined, false],
    ['production', true, true],
    ['production', false, false],
    ['development', undefined, true],
    ['development', false, false],
    ['test', undefined, true],
  ] as const)('NODE_ENV=%s, API_DOCS_ENABLED=%s → %s', (nodeEnv, apiDocsEnabled, expected) => {
    expect(
      isApiDocsEnabled(configWith({ NODE_ENV: nodeEnv, API_DOCS_ENABLED: apiDocsEnabled })),
    ).toBe(expected);
  });
});
