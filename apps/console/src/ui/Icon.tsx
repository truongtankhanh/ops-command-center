import type { Glyph } from './icons';
import styles from './Icon.module.css';

/** The sizes the approved mockups use; 18 is the default glyph next to body text. */
export type IconSize = 14 | 16 | 18 | 20 | 22;

/**
 * Draws a glyph from `./icons` in the current text colour (`currentColor`); set `color` on the
 * parent's CSS Module to tint it.
 *
 * Accessibility contract: without `label` the icon is decorative and hidden from assistive tech
 * (the icon set adds `aria-hidden="true"`) — use this next to visible text. With `label` it is an
 * image with that accessible name — use this when the icon stands alone. There is no `title` prop
 * on purpose: the icon set treats `title` as a label and would drop `aria-hidden`.
 */
export function Icon({
  glyph: GlyphComponent,
  size = 18,
  label,
  className,
}: {
  glyph: Glyph;
  size?: IconSize;
  label?: string;
  className?: string;
}) {
  return (
    <GlyphComponent
      size={size}
      strokeWidth={2}
      className={className ? `${styles.icon} ${className}` : styles.icon}
      {...(label ? { role: 'img', 'aria-label': label } : {})}
    />
  );
}
