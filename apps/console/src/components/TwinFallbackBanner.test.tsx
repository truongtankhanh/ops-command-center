import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as CapabilityModule from '../lib/twinCapability';
import { twinCapability, type TwinCapability } from '../lib/twinCapability';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import { TwinFallbackBanner } from './TwinFallbackBanner';
import { ViewSwitch } from './ViewSwitch';

// The capability is a constant until V2-12; the cases that need another answer set it here. It keeps
// the real answer by default: the store reads it when its module is first imported.
vi.mock('../lib/twinCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof CapabilityModule>();
  return { ...actual, twinCapability: vi.fn(actual.twinCapability) };
});

const KEY = 'occ.console.twinBannerDismissed';
const NOT_BUILT: TwinCapability = { available: false, reason: 'not-built' };
const NO_WEBGL2: TwinCapability = { available: false, reason: 'no-webgl2' };

const dismiss = () => screen.getByRole('button', { name: 'Dismiss' });

describe('TwinFallbackBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStore(useConsole);
    vi.mocked(twinCapability).mockReturnValue(NOT_BUILT);
  });

  afterEach(() => vi.restoreAllMocks());

  it('says the twin is not in this version, and that the 2D map shows the same', () => {
    render(<TwinFallbackBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent("3D view isn't available in this version");
    expect(banner).toHaveTextContent('The 2D map shows the same incidents, cameras and assets.');
  });

  it('uses frame 07 wording for a device that refuses WebGL 2', () => {
    vi.mocked(twinCapability).mockReturnValue(NO_WEBGL2);

    render(<TwinFallbackBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent("3D view isn't available on this device");
    expect(banner).toHaveTextContent('WebGL 2 is off or blocked.');
  });

  it('shows nothing where the twin can be drawn', () => {
    vi.mocked(twinCapability).mockReturnValue({ available: true });

    render(<TwinFallbackBanner />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('closes when dismissed, and stays closed for this tab', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TwinFallbackBanner />);

    await user.click(dismiss());

    expect(screen.queryByRole('status')).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBe('not-built');
    expect(localStorage.getItem(KEY)).toBeNull();

    unmount();
    render(<TwinFallbackBanner />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows again for another reason than the one dismissed', () => {
    sessionStorage.setItem(KEY, 'no-webgl2');

    render(<TwinFallbackBanner />);

    expect(screen.getByRole('status')).toHaveTextContent("isn't available in this version");
  });

  it('hands focus to the 3D option when it is dismissed', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TwinFallbackBanner />
        <ViewSwitch />
      </>,
    );

    await user.click(dismiss());

    expect(screen.getByRole('button', { name: '3D' })).toHaveFocus();
  });

  it('still closes when storage is blocked', async () => {
    const user = userEvent.setup();
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    render(<TwinFallbackBanner />);

    await user.click(dismiss());

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    render(<TwinFallbackBanner />);

    await expectNoAxeViolations();
  });
});
