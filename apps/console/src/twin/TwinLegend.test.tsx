import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapLegend } from '../components/MapLegend';
import { expectNoAxeViolations } from '../test-utils';
import { TwinLegend } from './TwinLegend';

const KEY = 'occ.console.mapLegendOpen';

const entries = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('TwinLegend', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => vi.restoreAllMocks());

  it('is open by default, with the legend toggle expanded', () => {
    render(<TwinLegend />);

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list')).toBeVisible();
  });

  it('lists the open and handled incidents, the camera and the asset, as frame 01 does', () => {
    render(<TwinLegend />);

    expect(entries()).toEqual(['Open', 'Being handled', 'Camera', 'Asset — hover for readings']);
  });

  // A swatch is a shape and the words say what it is: neither is read twice nor needed alone.
  it('hides the swatches from assistive tech', () => {
    render(<TwinLegend />);

    const swatches = document.querySelectorAll('li > span');
    expect(swatches).toHaveLength(3);
    for (const swatch of swatches) expect(swatch).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes and opens the list, and says so on the toggle', async () => {
    const user = userEvent.setup();
    render(<TwinLegend />);

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('list')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(screen.getByRole('list')).toBeVisible();
  });

  it('remembers it in this browser, in the key the 2D legend uses', async () => {
    const user = userEvent.setup();
    render(<TwinLegend />);

    await user.click(screen.getByRole('button', { name: 'Legend' }));

    expect(localStorage.getItem(KEY)).toBe('false');
  });

  it('shares the preference with the 2D legend: closed there, closed here', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<MapLegend />);
    await user.click(screen.getByRole('button', { name: 'Legend' }));
    unmount();

    render(<TwinLegend />);

    expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens and works when storage is blocked', async () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    const user = userEvent.setup();
    render(<TwinLegend />);

    expect(screen.getByRole('list')).toBeVisible();
    await expect(
      user.click(screen.getByRole('button', { name: 'Legend' })),
    ).resolves.toBeUndefined();
  });

  it('has no accessibility violations, open and closed', async () => {
    const user = userEvent.setup();
    render(<TwinLegend />);
    await expectNoAxeViolations();

    await user.click(screen.getByRole('button', { name: 'Legend' }));
    await expectNoAxeViolations();
  });
});
