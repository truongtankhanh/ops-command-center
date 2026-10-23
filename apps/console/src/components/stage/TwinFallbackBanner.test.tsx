import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as CapabilityModule from '../../lib/twin-core/twinCapability';
import { twinCapability, type TwinCapability } from '../../lib/twin-core/twinCapability';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { TwinFallbackBanner } from './TwinFallbackBanner';
import { ViewSwitch } from './ViewSwitch';

// The cases that need another answer set it here. It keeps the real answer by default (no WebGL 2
// under jsdom): the store reads it when its module is first imported.
vi.mock('../../lib/twin-core/twinCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof CapabilityModule>();
  return { ...actual, twinCapability: vi.fn(actual.twinCapability) };
});

const KEY = 'occ.console.twinBannerDismissed';
const NO_WEBGL2: TwinCapability = { available: false, reason: 'no-webgl2' };

const dismiss = () => screen.getByRole('button', { name: 'Dismiss' });

describe('TwinFallbackBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStore(useConsole);
    vi.mocked(twinCapability).mockReturnValue(NO_WEBGL2);
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses frame 07 wording for a device that refuses WebGL 2', () => {
    render(<TwinFallbackBanner />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent("3D view isn't available on this device");
    expect(banner).toHaveTextContent('WebGL 2 is off or blocked.');
    expect(banner).toHaveTextContent('The 2D map shows the same incidents, cameras and assets.');
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
    expect(sessionStorage.getItem(KEY)).toBe('no-webgl2');
    expect(localStorage.getItem(KEY)).toBeNull();

    unmount();
    render(<TwinFallbackBanner />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows again for another reason than the one dismissed', () => {
    sessionStorage.setItem(KEY, 'context-lost');

    render(<TwinFallbackBanner />);

    expect(screen.getByRole('status')).toHaveTextContent("isn't available on this device");
  });

  // The capability follows the store's fault, as the real one does; the twin is fine until it is lost.
  describe('when the context is lost during the session', () => {
    beforeEach(() => {
      vi.mocked(twinCapability).mockImplementation((fault) =>
        fault ? { available: false, reason: fault } : { available: true },
      );
    });

    const lose = () => act(() => useConsole.getState().markTwinLost());

    it('appears with the words of a lost context', () => {
      render(<TwinFallbackBanner />);
      expect(screen.queryByRole('status')).toBeNull();

      lose();

      const banner = screen.getByRole('status');
      expect(banner).toHaveTextContent('3D view stopped working');
      expect(banner).toHaveTextContent('The graphics context was lost and did not come back.');
    });

    it('shows again after a dismissal for another reason', () => {
      sessionStorage.setItem(KEY, 'no-webgl2');
      render(<TwinFallbackBanner />);

      lose();

      expect(screen.getByRole('status')).toHaveTextContent('3D view stopped working');
    });

    it('stays closed when this reason was dismissed earlier in the tab', () => {
      sessionStorage.setItem(KEY, 'context-lost');
      render(<TwinFallbackBanner />);

      lose();

      expect(screen.queryByRole('status')).toBeNull();
    });
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
