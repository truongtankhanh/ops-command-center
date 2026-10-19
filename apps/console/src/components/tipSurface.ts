import styles from './Tips.module.css';

/**
 * The class that gives a tooltip its surface and makes the bodies of `Tips.tsx` read right (V2-15.5). The
 * bodies' rules are scoped under it (`.tip p + p`, `.tip .foot`), so whoever shows a body puts this on the
 * element around it and adds only its own placement. A module of its own and not an export of `Tips.tsx`,
 * which exports components only (react-refresh).
 */
export const tipSurface: string = styles.tip ?? '';
