/**
 * Domain vocabulary shared by the API and every client.
 * Enum-like values are `as const` tuples so they can be iterated at runtime
 * (validation, filters) and narrowed at compile time.
 */

export * from './geo';
export * from './incident';
export * from './zone';
export * from './camera';
export * from './site-plan';
export * from './telemetry';
export * from './asset';
