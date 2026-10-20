import type { Role } from '@occ/contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '../auth/store';
import { useConsole } from '../store';
import { expectNoAxeViolations, resetStore, stubTwinAvailable, unstubTwin } from '../test-utils';
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
    for (const name of ['Incident and asset lists', 'Tabs', '2D map, while it has focus']) {
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

/** The roles a help is read as, with the account the session gets. */
const ACCOUNTS: readonly { role: Role; displayName: string; actions: boolean }[] = [
  { role: 'operator', displayName: 'Demo Operator', actions: true },
  { role: 'technician', displayName: 'Demo Technician', actions: true },
  { role: 'viewer', displayName: 'Demo Viewer', actions: false },
];

/** Every role with 3D available or not and single-key shortcuts on or off (V2-18.1). */
const CELLS = ACCOUNTS.flatMap((account) =>
  [true, false].flatMap((twin) => [true, false].map((keysOn) => ({ ...account, twin, keysOn }))),
);

const headings = () =>
  within(help()!)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
const has = (key: string) => keys(key).length > 0;

describe('ShortcutHelp and the 3D view', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
  });

  afterEach(() => {
    unstubTwin();
    vi.restoreAllMocks();
  });

  const signInAs = (account: (typeof ACCOUNTS)[number]) =>
    act(() =>
      useSession.getState().signedIn({ displayName: account.displayName, roles: [account.role] }),
    );

  it.each(CELLS)(
    'as $role, with 3D $twin and single-key shortcuts $keysOn, lists what applies',
    ({ twin, keysOn, ...account }) => {
      if (twin) stubTwinAvailable();
      signInAs(account);
      act(() => useConsole.setState({ keyboardShortcuts: keysOn }));
      renderHelp();

      openFromMenu();

      // V and F: 3D and the single-key switch, and no role needed. F is listed where it acts: three times.
      expect(keys('V')).toHaveLength(twin && keysOn ? 1 : 0);
      expect(keys('F')).toHaveLength(twin && keysOn ? 3 : 0);
      // The 3D view's own keys are not character keys: 3D alone decides, not the switch.
      for (const key of ['Drag', 'Wheel', 'Click', 'arrows', '−']) expect(has(key)).toBe(twin);
      expect(headings().includes('3D view, while it has focus')).toBe(twin);
      expect(headings().includes('3D view, pointer and touch')).toBe(twin);
      expect(headings().includes('Asset inspector')).toBe(twin);
      expect(!!within(help()!).queryByText('Reset to the campus view')).toBe(twin);
      // N, A and R: the role and the switch, as before and whatever 3D does.
      for (const key of ['N', 'A', 'R'])
        expect(keys(key)).toHaveLength(account.actions && keysOn ? 1 : 0);
    },
  );

  it("lists the groups in frame 16's order when 3D is available, and V1's when it is not", () => {
    stubTwinAvailable();
    renderHelp();

    openFromMenu();
    expect(headings()).toEqual([
      'Anywhere',
      '3D view, while it has focus',
      '3D view, pointer and touch',
      'Incident panel',
      'Asset inspector',
      'Incident and asset lists',
      '2D map, while it has focus',
      'Tabs',
      'Dialogs and menus',
    ]);

    unstubTwin();
    vi.restoreAllMocks();
    act(() => useConsole.getState().closeShortcutHelp());
    // Without 3D the same groups come back to V1's, the map renamed and before the tabs.
    openFromMenu();
    expect(headings()).toEqual([
      'Anywhere',
      'Incident panel',
      'Incident and asset lists',
      '2D map, while it has focus',
      'Tabs',
      'Dialogs and menus',
    ]);
  });

  it('shows a viewer V, F and the 3D keys and no N, A or R', () => {
    stubTwinAvailable();
    signInAs(ACCOUNTS[2]!);
    renderHelp();

    openFromMenu();

    for (const key of ['V', 'F', 'Drag']) expect(has(key)).toBe(true);
    for (const key of ['N', 'A', 'R']) expect(has(key)).toBe(false);
  });

  it("still reads a technician's A and R as Facilities and Environment incidents", () => {
    stubTwinAvailable();
    signInAs(ACCOUNTS[1]!);
    renderHelp();

    openFromMenu();

    const dialog = within(help()!);
    expect(
      dialog.getByText('Acknowledge — Facilities and Environment incidents'),
    ).toBeInTheDocument();
    expect(dialog.getByText('Resolve — Facilities and Environment incidents')).toBeInTheDocument();
  });

  it('keeps the 3D keys, and drops V and F, when single-key shortcuts go off', () => {
    stubTwinAvailable();
    act(() => useConsole.setState({ keyboardShortcuts: false }));
    renderHelp();

    openFromMenu();

    expect(help()).toHaveAccessibleDescription(OFF_INTRO);
    for (const key of ['V', 'F']) expect(has(key)).toBe(false);
    for (const key of ['Home', 'Wheel', 'arrows']) expect(has(key)).toBe(true);
  });

  it('draws a chord as two keys joined by a plus, and plain alternatives without one', () => {
    stubTwinAvailable();
    renderHelp();

    openFromMenu();

    const dialog = within(help()!);
    const pan = dialog.getByText('Pan').parentElement!;
    expect(within(pan).getAllByText(/^(Shift|arrows)$/, { selector: 'kbd' })).toHaveLength(2);
    expect(pan).toHaveTextContent('Shift+arrows');
    const dragPan = dialog.getByText('Pan (also right-drag, two-finger drag)').parentElement!;
    expect(dragPan).toHaveTextContent('Shift+Drag');
    const orbit = dialog.getByText('Orbit around the target').parentElement!;
    expect(within(orbit).queryByText('+')).toBeNull();
    expect(orbit).toHaveTextContent('←→');
  });

  it('reads a word key out as text, like any other key', () => {
    stubTwinAvailable();
    renderHelp();

    openFromMenu();

    expect(keys('Wheel')[0]).not.toHaveAttribute('aria-hidden');
  });

  it('lists none of it once the 3D view has failed in this session', () => {
    stubTwinAvailable();
    renderHelp();
    openFromMenu();
    expect(has('Wheel')).toBe(true);

    act(() => useConsole.setState({ twinFault: 'context-lost' }));

    expect(has('Wheel')).toBe(false);
    expect(has('V')).toBe(false);
  });

  it('has no axe violations with the 3D groups listed', async () => {
    stubTwinAvailable();
    renderHelp();

    openFromMenu();

    await expectNoAxeViolations();
  });
});
