import { nextTabIndex } from './tabNavigation';

describe('nextTabIndex', () => {
  it('moves right and wraps from the last tab to the first', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
  });

  it('moves left and wraps from the first tab to the last', () => {
    expect(nextTabIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextTabIndex('Home', 2, 3)).toBe(0);
    expect(nextTabIndex('End', 0, 3)).toBe(2);
  });

  it.each(['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a'])('leaves %j to the browser', (key) => {
    expect(nextTabIndex(key, 1, 3)).toBeNull();
  });
});
