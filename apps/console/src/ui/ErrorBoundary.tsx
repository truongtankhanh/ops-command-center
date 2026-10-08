import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps a render error inside one region of the console (feed, map, cameras, the sheet), so the
 * rest keeps working: the region shows `fallback` instead. `retry` remounts the region; a query
 * that failed refetches when it mounts again.
 *
 * Only render errors arrive here. A failed request is not one: queries do not throw, each region
 * shows its own load error.
 *
 * The console's only class component: React 19 still offers error boundaries to classes only,
 * and these few lines do not justify a dependency.
 */
export class ErrorBoundary extends Component<
  {
    /** Names the region in the log, so a report says which part of the console failed. */
    region: string;
    fallback: (retry: () => void) => ReactNode;
    children: ReactNode;
  },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // No error-tracking service yet: the browser console is the only report.
    console.error(`${this.props.region} stopped working`, error, info.componentStack);
  }

  private readonly retry = () => this.setState({ failed: false });

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}
