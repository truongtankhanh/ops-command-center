import { ROLES } from '@occ/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '../../auth/store';
import type * as CriticalCue from '../../lib/incidents/criticalCue';
import { playCriticalCue, unlockAudio } from '../../lib/incidents/criticalCue';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { SettingsSwitches } from './SettingsSwitches';

// jsdom has no Web Audio; the sound preference itself is stored by the real module (as `Header.test.tsx`).
vi.mock('../../lib/incidents/criticalCue', async (importOriginal) => ({
  ...(await importOriginal<typeof CriticalCue>()),
  unlockAudio: vi.fn(),
  playCriticalCue: vi.fn(),
}));

const sound = () => screen.getByRole('switch', { name: 'Sound for critical incidents' });
const shortcuts = () => screen.getByRole('switch', { name: 'Single-key shortcuts' });
const compact = () => screen.getByRole('switch', { name: 'Compact layout' });
const help = () => screen.getByRole('button', { name: 'Keyboard shortcuts' });

describe('SettingsSwitches', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore(useConsole);
    resetStore(useSession);
    vi.mocked(unlockAudio).mockReset().mockResolvedValue(true);
    vi.mocked(playCriticalCue).mockReset();
  });

  it('draws the three switches in order, then the help button, from the store', () => {
    render(<SettingsSwitches close={() => {}} />);

    expect(screen.getAllByRole('switch').map((node) => node.textContent)).toEqual([
      'Sound for critical incidents',
      'Single-key shortcuts',
      'Compact layout',
    ]);
    expect(sound()).toHaveAttribute('aria-checked', 'false');
    expect(shortcuts()).toHaveAttribute('aria-checked', 'true');
    expect(compact()).toHaveAttribute('aria-checked', 'false');
    expect(help()).toBeInTheDocument();
  });

  it('toggles the same state the account menu does', async () => {
    render(<SettingsSwitches close={() => {}} />);

    await userEvent.click(shortcuts());
    expect(useConsole.getState().keyboardShortcuts).toBe(false);
    expect(shortcuts()).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(shortcuts());
    expect(useConsole.getState().keyboardShortcuts).toBe(true);

    await userEvent.click(compact());
    expect(useConsole.getState().density).toBe('compact');
    expect(compact()).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(compact());
    expect(useConsole.getState().density).toBe('comfortable');
  });

  describe('the sound', () => {
    it('turns on, unlocks audio with this click and plays the cue once', async () => {
      render(<SettingsSwitches close={() => {}} />);

      await userEvent.click(sound());

      expect(sound()).toHaveAttribute('aria-checked', 'true');
      expect(useConsole.getState().criticalSound).toBe(true);
      expect(unlockAudio).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(playCriticalCue).toHaveBeenCalledWith({ preview: true }));
      expect(playCriticalCue).toHaveBeenCalledTimes(1);
    });

    it('stays on without a preview when the browser blocks audio', async () => {
      vi.mocked(unlockAudio).mockResolvedValue(false);
      render(<SettingsSwitches close={() => {}} />);

      await userEvent.click(sound());
      await vi.mocked(unlockAudio).mock.results[0]!.value;

      expect(sound()).toHaveAttribute('aria-checked', 'true');
      expect(playCriticalCue).not.toHaveBeenCalled();
    });

    it('turns off without touching audio', async () => {
      useConsole.setState({ criticalSound: true });
      render(<SettingsSwitches close={() => {}} />);

      await userEvent.click(sound());

      expect(sound()).toHaveAttribute('aria-checked', 'false');
      expect(useConsole.getState().criticalSound).toBe(false);
      expect(unlockAudio).not.toHaveBeenCalled();
    });
  });

  describe('the shortcuts help', () => {
    it('shows ? on the button only while the single-key shortcuts are on', async () => {
      render(<SettingsSwitches close={() => {}} />);
      expect(help()).toHaveAttribute('aria-keyshortcuts', '?');

      await userEvent.click(shortcuts());

      expect(help()).not.toHaveAttribute('aria-keyshortcuts');
    });

    it('closes the popover before it opens, so focus can come back to the trigger', async () => {
      let helpOpenWhenClosed: boolean | undefined;
      const close = vi.fn(() => {
        helpOpenWhenClosed = useConsole.getState().shortcutHelpOpen;
      });
      render(<SettingsSwitches close={close} />);

      await userEvent.click(help());

      expect(close).toHaveBeenCalledTimes(1);
      expect(helpOpenWhenClosed).toBe(false);
      expect(useConsole.getState().shortcutHelpOpen).toBe(true);
    });
  });

  it.each(ROLES)('is the same for a %s: these are display preferences', (role) => {
    useSession.setState({ status: 'signed-in', user: { displayName: 'Test', roles: [role] } });
    render(<SettingsSwitches close={() => {}} />);

    expect(screen.getAllByRole('switch')).toHaveLength(3);
    expect(help()).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    render(<SettingsSwitches close={() => {}} />);

    await expectNoAxeViolations();
  });
});
