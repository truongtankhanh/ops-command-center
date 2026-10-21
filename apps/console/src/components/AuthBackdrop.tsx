import styles from './AuthBackdrop.module.css';

/**
 * The picture behind the sign-in screens (V2-20.6, frame 19): the same stylised campus the Keycloak sign-in page
 * stands on, so the hand-off to Keycloak and back reads as one page. A static poster, not the loop: these screens
 * last a moment.
 *
 * Decoration only. It is hidden from assistive technology, holds no text and takes no pointer, and carries no
 * site data (the picture is invented; see `ops/keycloak/themes/occ/BACKDROP.md`). `public/sign-in-backdrop.webp`
 * is a copy of the theme's poster, checked for drift by `scripts/contrast.ts` (V2-20.7). The file is not named
 * `auth-…`: the dev server proxies every path that starts with `/auth` to Keycloak.
 *
 * It is a CSS background, so a missing file leaves the plain `--surface-0` page. It has to be the first child
 * of the screen: the card above it is `position: relative` with a higher `z-index`.
 */
export function AuthBackdrop() {
  return <div className={styles.backdrop} data-backdrop aria-hidden="true" />;
}
