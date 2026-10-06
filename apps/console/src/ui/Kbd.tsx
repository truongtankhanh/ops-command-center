import styles from './Kbd.module.css';

/**
 * A key hint (frame 00). Hidden from assistive tech: the control it sits on announces the shortcut
 * through `aria-keyshortcuts` instead, so its accessible name stays its visible label. Show a hint
 * only for a shortcut that works.
 */
export function Kbd({ children, className }: { children: string; className?: string }) {
  return (
    <kbd aria-hidden="true" className={className ? `${styles.kbd} ${className}` : styles.kbd}>
      {children}
    </kbd>
  );
}
