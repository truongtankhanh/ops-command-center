import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore } from '../test-utils';
import { ShortcutHelp } from './ShortcutHelp';

/** The help beside an opener (to give focus back to) and a text field (where keys are typed). */
function renderHelp() {
  return render(
    <>
      <button type="button">Opener</button>
      <input aria-label="Notes" />
      <ShortcutHelp />
    </>,
  );
}

const help = () => screen.queryByRole('dialog', { name: 'Keyboard shortcuts' });
/** Every row showing `key` in the open help; some keys (Esc, Home…) are listed in several groups. */
const keys = (key: string) => within(help()!).queryAllByText(key, { selector: 'kbd' });
const opener = () => screen.getByRole('button', { name: 'Opener' });
const openFromMenu = () => act(() => useConsole.getState().openShortcutHelp());

const ON_INTRO = 'Single-key shortcuts do nothing while you type in a text field.';
const OFF_INTRO = 'Single-key shortcuts are off. Turn them on in the account menu.';

describe('ShortcutHelp', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
  });

  it('opens with ? and lists the single-key shortcuts an operator can use', async () => {
    renderHelp();

    await userEvent.keyboard('?');

    expect(help()).not.toBeNull();
    for (const key of ['N', '/', '?', 'A', 'R']) expect(keys(key)).toHaveLength(1);
    for (const name of ['Incident list', 'Tabs', 'Map, while it has focus']) {
      expect(within(help()!).getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('is described by its intro, not by the whole list', async () => {
    renderHelp();

    await userEvent.keyboard('?');

    expect(help()).toHaveAccessibleDescription(ON_INTRO);
  });

  it('reads the keys out as text', async () => {
    renderHelp();

    await userEvent.keyboard('?');

    // The keys are the content here, unlike a hint on a button.
    expect(keys('N')[0]).not.toHaveAttribute('aria-hidden');
  });

  it("opens from the account menu's entry too", () => {
    renderHelp();

    openFromMenu();

    expect(help()).not.toBeNull();
  });

  it('closes on Close and on Escape, and gives focus back', async () => {
    renderHelp();
    act(() => opener().focus());

    await userEvent.keyboard('?');
    await userEvent.click(within(help()!).getByRole('button', { name: 'Close' }));
    expect(help()).toBeNull();
    expect(useConsole.getState().shortcutHelpOpen).toBe(false);
    await waitFor(() => expect(opener()).toHaveFocus());

    await userEvent.keyboard('?');
    await userEvent.keyboard('{Escape}');
    expect(help()).toBeNull();
    expect(useConsole.getState().shortcutHelpOpen).toBe(false);
    await waitFor(() => expect(opener()).toHaveFocus());
  });

  it('has no axe violations', async () => {
    renderHelp();

    await userEvent.keyboard('?');

    await expectNoAxeViolations();
  });

  it('ignores ? while single-key shortcuts are off, and says so when opened from the menu', async () => {
    act(() => useConsole.setState({ keyboardShortcuts: false }));
    renderHelp();

    await userEvent.keyboard('?');
    expect(help()).toBeNull();

    openFromMenu();
    expect(help()).toHaveAccessibleDescription(OFF_INTRO);
    for (const key of ['N', '/', '?', 'A', 'R']) expect(keys(key)).toHaveLength(0);
    // Keys that only act where focus is are not character keys: still listed.
    for (const key of ['Home', 'Esc', 'Tab']) expect(keys(key).length).toBeGreaterThan(0);
  });

  it('ignores ? typed in a text field', async () => {
    renderHelp();

    await userEvent.type(screen.getByLabelText('Notes'), '?');

    expect(screen.getByLabelText('Notes')).toHaveValue('?');
    expect(help()).toBeNull();
  });

  it('shows a viewer no operator keys', async () => {
    act(() => useSession.getState().signedIn({ displayName: 'Demo Viewer', roles: ['viewer'] }));
    renderHelp();

    await userEvent.keyboard('?');

    for (const key of ['N', 'A', 'R']) expect(keys(key)).toHaveLength(0);
    for (const key of ['/', '?']) expect(keys(key)).toHaveLength(1);
    // Its Esc row needs no role, so the group stays.
    expect(within(help()!).getByRole('heading', { name: 'Incident panel' })).toBeInTheDocument();
  });

  it('describes A and R plainly to an operator, who may act on every category', async () => {
    renderHelp();

    await userEvent.keyboard('?');

    const dialog = within(help()!);
    expect(dialog.getByText('Acknowledge')).toBeInTheDocument();
    expect(dialog.getByText('Resolve')).toBeInTheDocument();
    expect(dialog.queryByText(/Facilities and Environment/)).toBeNull();
  });

  it('shows a technician A and R for Facilities and Environment incidents', async () => {
    act(() =>
      useSession.getState().signedIn({ displayName: 'Demo Technician', roles: ['technician'] }),
    );
    renderHelp();

    await userEvent.keyboard('?');

    const dialog = within(help()!);
    expect(
      dialog.getByText('Acknowledge — Facilities and Environment incidents'),
    ).toBeInTheDocument();
    expect(dialog.getByText('Resolve — Facilities and Environment incidents')).toBeInTheDocument();
    // Reporting is not limited by category: its row is the plain one.
    expect(dialog.getByText('Report an incident')).toBeInTheDocument();
    for (const key of ['N', 'A', 'R']) expect(keys(key)).toHaveLength(1);
  });

  it('lists no A or R for a technician while single-key shortcuts are off', async () => {
    act(() => {
      useSession.getState().signedIn({ displayName: 'Demo Technician', roles: ['technician'] });
      useConsole.setState({ keyboardShortcuts: false });
    });
    renderHelp();

    openFromMenu();

    for (const key of ['N', 'A', 'R']) expect(keys(key)).toHaveLength(0);
    expect(within(help()!).queryByText(/Facilities and Environment/)).toBeNull();
  });

  it('stays one dialog when ? is pressed again', async () => {
    renderHelp();

    await userEvent.keyboard('?');
    await userEvent.keyboard('?');

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});
