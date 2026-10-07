import { nextRowIndex } from './rowNavigation';

describe('nextRowIndex', () => {
  it('moves down one row and stops at the last', () => {
    expect(nextRowIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextRowIndex('ArrowDown', 2, 3)).toBe(2);
  });

  it('moves up one row and stops at the first', () => {
    expect(nextRowIndex('ArrowUp', 2, 3)).toBe(1);
    expect(nextRowIndex('ArrowUp', 0, 3)).toBe(0);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextRowIndex('Home', 2, 3)).toBe(0);
    expect(nextRowIndex('End', 0, 3)).toBe(2);
  });

  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End'])('stays on the only row with %s', (key) => {
    expect(nextRowIndex(key, 0, 1)).toBe(0);
  });

  // Unlike tabs, a vertical list does not use the left and right arrows.
  it.each(['Enter', ' ', 'Tab', 'ArrowLeft', 'ArrowRight', 'PageDown', 'a'])(
    'leaves %j to the browser',
    (key) => {
      expect(nextRowIndex(key, 1, 3)).toBeNull();
    },
  );
});
