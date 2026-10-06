import styles from './Brand.module.css';

/**
 * Product identity (frames 01 and 08): mark, product name as the page's `h1`, and the site. `md`
 * sits in a row in the header; `lg` is stacked and centred on the sign-in screens.
 *
 * The site is text, not a control, until a site switcher exists. The mark is drawn inline so its
 * colours come from the tokens. `public/favicon.svg` draws the same mark on `--surface-0` instead
 * of `--surface-3`; `scripts/contrast.ts` checks its colours against the tokens.
 */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div className={styles.brand} data-size={size === 'lg' ? 'lg' : undefined}>
      <svg className={styles.mark} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect className={styles.ground} width="32" height="32" rx="8" />
        <circle className={styles.ring} cx="16" cy="16" r="9" />
        <circle className={styles.dot} cx="16" cy="16" r="3.5" />
      </svg>
      <div>
        <h1 className={styles.name}>Ops Command Center</h1>
        <p className={styles.site}>Langbiang Tech Campus</p>
      </div>
    </div>
  );
}
