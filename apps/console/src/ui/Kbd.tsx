import styles from './Kbd.module.css';

/**
 * A key hint (frame 00). Hidden from assistive tech by default: the control it sits on announces
 * the shortcut through `aria-keyshortcuts` instead, so its accessible name stays its visible label.
 * Show a hint only for a shortcut that works.
 *
 * `decorative={false}` is for a key that is the content itself, such as a row of the keyboard
 * shortcuts help: then it is read out like any text.
 */
export function Kbd({
  decorative = true,
  className,
  children,
}: {
  decorative?: boolean;
  className?: string;
  children: string;
}) {
  return (
    <kbd
      aria-hidden={decorative || undefined}
      className={className ? `${styles.kbd} ${className}` : styles.kbd}
    >
      {children}
    </kbd>
  );
}
