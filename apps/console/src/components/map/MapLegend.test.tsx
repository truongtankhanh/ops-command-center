import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapLegend } from './MapLegend';

const KEY = 'occ.console.mapLegendOpen';

const entries = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('MapLegend', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => vi.restoreAllMocks());

  it('is open by default, with the legend toggle expanded', () => {
    render(<MapLegend />);

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list')).toBeVisible();
  });

  it('lists the incidents, cameras, camera views and assets, severity last', () => {
    render(<MapLegend />);

    expect(entries()).toEqual([
      'Open',
      'Being handled',
      '3Several incidents, badge = most severe',
      'Camera',
      'Camera offline',
      'Camera view',
      'Asset',
      'Asset fault',
      'Asset no data',
      'Colour = severity',
    ]);
  });

  it('puts the asset entries after the camera view and before the severity note', () => {
    render(<MapLegend />);

    const all = entries();
    expect(all.indexOf('Asset')).toBeGreaterThan(all.indexOf('Camera view'));
    expect(all.indexOf('Asset no data')).toBeLessThan(all.indexOf('Colour = severity'));
    expect(all.at(-1)).toBe('Colour = severity');
  });

  // A swatch is a shape and the words say what it is: neither is read twice nor needed alone.
  it('hides the asset swatches from assistive tech and tells their looks apart by attribute', () => {
    render(<MapLegend />);

    const swatches = [...document.querySelectorAll('li > span:first-child')].filter((span) =>
      span.closest('li')?.textContent?.startsWith('Asset'),
    );
    expect(swatches).toHaveLength(3);
    for (const swatch of swatches) expect(swatch).toHaveAttribute('aria-hidden', 'true');
    expect(swatches.map((s) => s.getAttribute('data-look'))).toEqual([null, 'fault', 'nodata']);
  });

  it('closes and remembers it in this browser', async () => {
    const user = userEvent.setup();
    render(<MapLegend />);

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('opens and works when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const user = userEvent.setup();
    render(<MapLegend />);

    expect(screen.getByRole('list')).toBeVisible();
    await expect(
      user.click(screen.getByRole('button', { name: 'Legend' })),
    ).resolves.toBeUndefined();
  });
});
