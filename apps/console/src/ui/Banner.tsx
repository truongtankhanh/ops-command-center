import type { ReactNode } from 'react';
import styles from './Banner.module.css';
import { Icon } from './Icon';
import type { Glyph } from './icons';

/**
 * A system message that sits over the console (frames 05 / 07): session expired, live updates
 * paused. It always uses the warning tone. The caller places it (`className`) and picks how it is
 * announced. Use `alert` when the operator must act now, because it interrupts the screen reader.
 * Use `status` for information that clears by itself.
 *
 * Mount it when the condition starts and unmount it when it ends. An alert is announced when it is
 * inserted, so the banner must not be pre-rendered empty and filled in later.
 */
export function Banner({
  role,
  icon,
  action,
  className,
  children,
}: {
  role: 'alert' | 'status';
  icon?: Glyph;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role={role} className={className ? `${styles.banner} ${className}` : styles.banner}>
      {icon && <Icon glyph={icon} size={20} className={styles.icon} />}
      <div className={styles.message}>{children}</div>
      {action}
    </div>
  );
}
