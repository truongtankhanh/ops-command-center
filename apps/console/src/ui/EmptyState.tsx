import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';
import { Icon } from './Icon';
import type { Glyph } from './icons';

/**
 * A message in place of content that is loading, empty or failed to load. With an `icon` or an
 * `action` (e.g. Retry) it stacks them around the message; without either it is the bare message,
 * as the feed uses it. The icon is decorative: the message says it all. Added in UI-11 for the
 * detail's error state; UI-15 reuses them for the other regions.
 */
export function EmptyState({
  icon,
  action,
  className,
  children,
}: {
  icon?: Glyph;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const classes = className ? `${styles.empty} ${className}` : styles.empty;
  if (!icon && !action) return <p className={classes}>{children}</p>;
  return (
    <div className={classes} data-layout="stack">
      {icon && <Icon glyph={icon} size={22} className={styles.icon} />}
      <p className={styles.message}>{children}</p>
      {action}
    </div>
  );
}
