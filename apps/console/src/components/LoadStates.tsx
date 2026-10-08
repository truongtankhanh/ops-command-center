import { loadErrorText, RATE_LIMITED_RETRYING } from '../api/client';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { CircleX } from '../ui/icons';

/**
 * What a region shows when its data could not be loaded: why, in the operator's words
 * (`loadErrorText`: too many requests, no longer allowed, else `fallback`), and a Retry.
 */
export function LoadFailed({
  error,
  fallback,
  isFetching,
  onRetry,
  className,
}: {
  error: unknown;
  fallback: string;
  /** A retry is under way: the button shows it and cannot be pressed twice. */
  isFetching: boolean;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={CircleX}
      className={className}
      action={
        <Button loading={isFetching} onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {loadErrorText(error, fallback)}
    </EmptyState>
  );
}

/**
 * In place of a loading region while a 429 is being retried (`shouldRetryQuery`): calm, no action,
 * since the retries happen by themselves. Announced politely once, when it appears.
 */
export function RateLimited({ className }: { className?: string }) {
  return (
    <div role="status" className={className}>
      <EmptyState>{RATE_LIMITED_RETRYING}</EmptyState>
    </div>
  );
}

/**
 * An `ErrorBoundary`'s fallback: the region, still named for assistive tech, says it stopped
 * working and offers to start it again. `className` keeps the region's place in the layout.
 */
export function RegionFallback({
  label,
  message,
  retry,
  retryLabel = 'Retry',
  className,
}: {
  label: string;
  message: string;
  retry: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <section aria-label={label} className={className}>
      <EmptyState icon={CircleX} action={<Button onClick={retry}>{retryLabel}</Button>}>
        {message}
      </EmptyState>
    </section>
  );
}
