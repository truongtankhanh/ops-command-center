import type { ComponentProps } from 'react';
import styles from './Panel.module.css';

export type PanelVariant = 'flat' | 'floating';

/**
 * A surface (ADR-0022 §4): a `div` with a hairline border and the large radius, in one of two looks.
 *
 * - `flat` (default) is `--surface-1`. `floating` is `--glass-bg`, about 90 % opaque, with the deep shadow, for a
 *   small overlay over the stage; it is the one place a translucent surface is drawn.
 * - `data-variant` is always set (`flat` or `floating`), so tests and later visual tests select on it, never on
 *   class names (ADR-0016 §4).
 * - Neither variant draws a glow. Blur is off until the 3D quality tier is High: the `data-twin-tier` contract in
 *   `styles/tokens.css`, which nothing sets before V3-18. Nothing here reads the tier from script.
 * - The panel sets no outer layout (`display`, `width`, `margin`); pass a `className` for that. Any other `div`
 *   attribute (`role`, `aria-label`, `ref`) passes through, since a bare `div` has no role of its own.
 *
 * Text on it is held to the `--surface-1` pairs and to the glass pairs in `docs/design/tokens.md`.
 */
export function Panel({
  variant = 'flat',
  className,
  ...props
}: ComponentProps<'div'> & { variant?: PanelVariant }) {
  return (
    <div
      {...props}
      className={className ? `${styles.panel} ${className}` : styles.panel}
      data-variant={variant}
    />
  );
}
