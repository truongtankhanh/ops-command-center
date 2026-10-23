import { renderHook } from '@testing-library/react';
import { type Density, readDensity, useDensityAttribute, writeDensity } from './density';

const KEY = 'occ.console.density';
const page = () => document.documentElement;

beforeEach(() => localStorage.clear());

afterEach(() => {
  vi.restoreAllMocks();
  // A failed case must not leave the page compact for the next one.
  delete page().dataset.density;
});

describe('the remembered density', () => {
  it('reads back what it wrote', () => {
    writeDensity('compact');
    expect(readDensity()).toBe('compact');
    expect(localStorage.getItem(KEY)).toBe('compact');

    writeDensity('comfortable');
    expect(readDensity()).toBe('comfortable');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is comfortable when nothing or something unknown is stored', () => {
    expect(readDensity()).toBe('comfortable');

    localStorage.setItem(KEY, 'cozy');

    expect(readDensity()).toBe('comfortable');
  });

  it('is comfortable, and remembering does not throw, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);

    expect(readDensity()).toBe('comfortable');
    expect(() => writeDensity('compact')).not.toThrow();
    expect(() => writeDensity('comfortable')).not.toThrow();
  });
});

describe('useDensityAttribute', () => {
  const renderDensity = (density: Density) =>
    renderHook((props: { density: Density }) => useDensityAttribute(props.density), {
      initialProps: { density },
    });

  it('marks the page compact', () => {
    renderDensity('compact');

    expect(page()).toHaveAttribute('data-density', 'compact');
  });

  it('leaves the page alone when comfortable', () => {
    renderDensity('comfortable');

    expect(page()).not.toHaveAttribute('data-density');
  });

  it('unmarks the page when switched back or unmounted', () => {
    const { rerender, unmount } = renderDensity('compact');

    rerender({ density: 'comfortable' });
    expect(page()).not.toHaveAttribute('data-density');

    rerender({ density: 'compact' });
    expect(page()).toHaveAttribute('data-density', 'compact');

    // Sign-out unmounts the console: the sign-in screens keep their designed spacing.
    unmount();
    expect(page()).not.toHaveAttribute('data-density');
  });
});
