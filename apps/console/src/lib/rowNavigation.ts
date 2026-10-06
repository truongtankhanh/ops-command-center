/**
 * The row a key press moves focus to in a vertical list with a roving tab stop: arrows step one
 * row and stop at the ends (a list does not wrap, unlike tabs), Home and End jump to the ends.
 * `null` means the key is not a list key and must be left to the browser.
 */
export function nextRowIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return Math.min(index + 1, count - 1);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
