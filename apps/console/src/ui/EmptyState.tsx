import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

/**
 * A message in place of content that is loading, empty or failed to load. Today it is the message
 * only; an icon and a retry action arrive with the designed states (UI-15).
 */
export function EmptyState({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={className ? `${styles.empty} ${className}` : styles.empty}>{children}</p>;
}
