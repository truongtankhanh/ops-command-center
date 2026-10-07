import styles from './Skeleton.module.css';

/**
 * A placeholder block where content is loading. Static on purpose: only arrival, selection and
 * escalation animate (principle 5), and a shimmer would be the one moving thing on a calm screen.
 *
 * Hidden from assistive tech: the caller announces the loading state once (a visually hidden
 * "Loading …" text and `aria-busy` on the region), not once per block. Its size comes from the
 * caller's `className`, so no dimension ends up in an inline style.
 */
export function Skeleton({
  shape = 'line',
  className,
}: {
  shape?: 'line' | 'circle';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={className ? `${styles.skeleton} ${className}` : styles.skeleton}
      data-shape={shape === 'circle' ? 'circle' : undefined}
    />
  );
}
