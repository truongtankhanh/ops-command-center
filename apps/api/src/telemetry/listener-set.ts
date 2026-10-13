import type { Logger } from '@nestjs/common';
import type { Unsubscribe } from './telemetry-source';

/**
 * The listeners of one event of a source. Notifying isolates them from each other and from the
 * source: a listener that throws, or returns a promise that rejects, is reported once and skipped,
 * because an unhandled rejection would take the process down (`TelemetrySource` contract).
 */
export class ListenerSet<T> {
  private readonly listeners = new Set<(value: T) => void>();
  private reportedFailure = false;

  constructor(private readonly logger: Logger) {}

  add(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(value: T): void {
    // A copy, so a listener that unsubscribes itself does not disturb the pass.
    for (const listener of [...this.listeners]) {
      try {
        const result: unknown = listener(value);
        if (result instanceof Promise) result.catch((error: unknown) => this.report(error));
      } catch (error) {
        this.report(error);
      }
    }
  }

  /** Once per set: a listener that fails on every reading must not flood the log (ADR-0019). */
  private report(error: unknown): void {
    if (this.reportedFailure) return;
    this.reportedFailure = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(`A telemetry listener failed; later failures are not logged: ${reason}`);
  }
}
