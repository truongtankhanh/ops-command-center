/**
 * The tab a key press moves to in a horizontal tab list (WAI-ARIA APG tabs pattern): arrows wrap
 * around, Home and End jump to the ends. `null` means the key is not a tab-list key and must be
 * left to the browser.
 */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
