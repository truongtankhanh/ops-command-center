import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '../../auth/store';
import { INCIDENT_TABLE_ID } from '../../lib/incidents/useIncidentTableShown';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore, stubViewportWidth } from '../../test-utils';
import { ShortcutHelp } from '../shell/ShortcutHelp';
import { FEED_VIEW_SWITCH_ID, FeedViewSwitch } from './FeedViewSwitch';

const group = () => screen.queryByRole('radiogroup', { name: 'Incident view' });
const radio = (name: 'List' | 'Table') => screen.getByRole('radio', { name });
const state = () => useConsole.getState();

beforeEach(() => {
  localStorage.clear();
  resetStore(useConsole);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FeedViewSwitch', () => {
  describe('the control', () => {
    it('is a radio group named "Incident view" with List then Table', () => {
      render(<FeedViewSwitch />);

      expect(group()).toBeInTheDocument();
      expect(screen.getAllByRole('radio').map((option) => option.textContent)).toEqual([
        'List',
        'Table',
      ]);
    });

    it('checks the list by default', () => {
      render(<FeedViewSwitch />);

      expect(radio('List')).toHaveAttribute('aria-checked', 'true');
      expect(radio('Table')).toHaveAttribute('aria-checked', 'false');
    });

    it('names each glyph-only option by its word and gives it a title', () => {
      render(<FeedViewSwitch />);

      expect(radio('List')).toHaveAttribute('title', 'List');
      expect(radio('Table')).toHaveAttribute('title', 'Table');
      expect(radio('Table').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('carries the id V3-24.5 returns focus to', () => {
      render(<FeedViewSwitch />);

      expect(group()).toHaveAttribute('id', FEED_VIEW_SWITCH_ID);
    });

    it('follows the store', () => {
      render(<FeedViewSwitch />);

      act(() => state().setFeedView('table'));

      expect(radio('Table')).toHaveAttribute('aria-checked', 'true');
      expect(radio('List')).toHaveAttribute('aria-checked', 'false');
    });

    it('has no axe violations', async () => {
      const { container } = render(<FeedViewSwitch />);

      await expectNoAxeViolations(container);
    });
  });

  describe('choosing', () => {
    it('chooses the table on a click, and remembers it', async () => {
      render(<FeedViewSwitch />);

      await userEvent.click(radio('Table'));

      expect(state().feedView).toBe('table');
      expect(radio('Table')).toHaveAttribute('aria-checked', 'true');
      expect(localStorage.getItem('occ.console.feedView')).toBe('table');
    });

    it('chooses with Space on a focused option', async () => {
      render(<FeedViewSwitch />);
      act(() => radio('Table').focus());

      await userEvent.keyboard(' ');

      expect(state().feedView).toBe('table');
    });

    it('changes the view and nothing else', async () => {
      act(() =>
        useConsole.setState({
          filter: 'all',
          severity: 'critical',
          category: 'fire_safety',
          selectedIncidentId: 'inc-7',
          tableSort: { key: 'raised', direction: 'descending' },
        }),
      );
      render(<FeedViewSwitch />);

      await userEvent.click(radio('Table'));

      expect(state()).toMatchObject({
        feedView: 'table',
        filter: 'all',
        severity: 'critical',
        category: 'fire_safety',
        selectedIncidentId: 'inc-7',
        sidePanel: 'incidents',
        tableSort: { key: 'raised', direction: 'descending' },
      });
    });
  });

  describe('the keyboard', () => {
    it('is one Tab stop, on the checked option', async () => {
      act(() => state().setFeedView('table'));
      render(
        <>
          <button type="button">Before</button>
          <FeedViewSwitch />
          <button type="button">After</button>
        </>,
      );

      await userEvent.tab();
      await userEvent.tab();
      expect(radio('Table')).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });

    it('moves and checks with ← and →, wrapping', async () => {
      render(<FeedViewSwitch />);
      act(() => radio('List').focus());

      await userEvent.keyboard('{ArrowRight}');
      expect(radio('Table')).toHaveFocus();
      expect(state().feedView).toBe('table');

      await userEvent.keyboard('{ArrowRight}');
      expect(radio('List')).toHaveFocus();
      expect(state().feedView).toBe('list');

      await userEvent.keyboard('{ArrowLeft}');
      expect(radio('Table')).toHaveFocus();
      expect(state().feedView).toBe('table');
    });

    it('moves and checks with ↓ and ↑ as with → and ←', async () => {
      render(<FeedViewSwitch />);
      act(() => radio('List').focus());

      await userEvent.keyboard('{ArrowDown}');
      expect(radio('Table')).toHaveFocus();
      expect(state().feedView).toBe('table');

      await userEvent.keyboard('{ArrowUp}');
      expect(radio('List')).toHaveFocus();
      expect(state().feedView).toBe('list');
    });

    it('jumps to the ends with Home and End', async () => {
      render(<FeedViewSwitch />);
      act(() => radio('List').focus());

      await userEvent.keyboard('{End}');
      expect(radio('Table')).toHaveFocus();
      expect(state().feedView).toBe('table');

      await userEvent.keyboard('{Home}');
      expect(radio('List')).toHaveFocus();
      expect(state().feedView).toBe('list');
    });

    it('moves the Tab stop with the checked option', async () => {
      render(<FeedViewSwitch />);
      act(() => radio('List').focus());

      await userEvent.keyboard('{ArrowRight}');

      expect(radio('Table')).toHaveAttribute('tabindex', '0');
      expect(radio('List')).toHaveAttribute('tabindex', '-1');
    });
  });

  describe('where it is offered', () => {
    it('is absent at a phone width, where the list is the only view', () => {
      stubViewportWidth(720);
      render(<FeedViewSwitch />);

      expect(group()).not.toBeInTheDocument();
    });

    it('is present just above the phone width', () => {
      stubViewportWidth(721);
      render(<FeedViewSwitch />);

      expect(group()).toBeInTheDocument();
    });

    it('goes and comes back as the window crosses the phone width', () => {
      const viewport = stubViewportWidth(1024);
      render(<FeedViewSwitch />);

      act(() => viewport.resize(700));
      expect(group()).not.toBeInTheDocument();

      act(() => viewport.resize(1024));
      expect(group()).toBeInTheDocument();
    });

    it('keeps a stored table on a phone, only not offering the switch', () => {
      act(() => state().setFeedView('table'));
      stubViewportWidth(720);
      render(<FeedViewSwitch />);

      expect(group()).not.toBeInTheDocument();
      expect(state().feedView).toBe('table');
      expect(localStorage.getItem('occ.console.feedView')).toBe('table');
    });

    it('is absent while the Assets panel is shown, and back on the Incidents panel', () => {
      render(<FeedViewSwitch />);

      act(() => state().setSidePanel('assets'));
      expect(group()).not.toBeInTheDocument();

      act(() => state().setSidePanel('incidents'));
      expect(group()).toBeInTheDocument();
    });
  });

  /*
   * `T` (V3-24.5), in `TwinShortcuts.test.tsx`'s style: what the key does, and where it must not. A stand-in for the table
   * (a section with the table's id and one focusable row) is enough to see where focus goes; the table's own keys are
   * `IncidentTable.test.tsx`'s.
   */
  describe('the T key', () => {
    /** The switch beside a text field, a control outside the table, a stand-in table and the help (a dialog). */
    function renderKeys() {
      return render(
        <>
          <input aria-label="Notes" />
          <button type="button">Elsewhere</button>
          <section id={INCIDENT_TABLE_ID} aria-label="Incident table">
            <button type="button">Row</button>
          </section>
          <FeedViewSwitch />
          <ShortcutHelp />
        </>,
      );
    }

    beforeEach(() => {
      resetStore(useSession);
      useSession.getState().signedIn({ displayName: 'Demo Operator', roles: ['operator'] });
    });

    it('switches between the list and the table, both ways, and remembers it', async () => {
      renderKeys();

      await userEvent.keyboard('t');
      expect(state().feedView).toBe('table');
      expect(localStorage.getItem('occ.console.feedView')).toBe('table');
      expect(radio('Table')).toHaveAttribute('aria-checked', 'true');

      await userEvent.keyboard('T');
      expect(state().feedView).toBe('list');
      expect(localStorage.getItem('occ.console.feedView')).toBeNull();
    });

    it('does nothing while single-key shortcuts are off', async () => {
      act(() => useConsole.setState({ keyboardShortcuts: false }));
      renderKeys();

      await userEvent.keyboard('t');

      expect(state().feedView).toBe('list');
    });

    it('is not typed into: a "t" in a text field only types', async () => {
      renderKeys();

      await userEvent.type(screen.getByLabelText('Notes'), 't');

      expect(screen.getByLabelText('Notes')).toHaveValue('t');
      expect(state().feedView).toBe('list');
    });

    it('ignores a modifier, a repeat and an IME composition', () => {
      renderKeys();

      fireEvent.keyDown(document.body, { key: 't', ctrlKey: true });
      fireEvent.keyDown(document.body, { key: 't', metaKey: true });
      fireEvent.keyDown(document.body, { key: 't', altKey: true });
      fireEvent.keyDown(document.body, { key: 't', repeat: true });
      fireEvent.keyDown(document.body, { key: 't', isComposing: true });

      expect(state().feedView).toBe('list');
    });

    it('does nothing while a dialog is open', async () => {
      renderKeys();
      act(() => useConsole.getState().openShortcutHelp());

      await userEvent.keyboard('t');

      expect(state().feedView).toBe('list');
    });

    it('does nothing while the Assets panel is shown, and works again on the Incidents panel', async () => {
      renderKeys();

      act(() => state().setSidePanel('assets'));
      await userEvent.keyboard('t');
      expect(state().feedView).toBe('list');

      act(() => state().setSidePanel('incidents'));
      await userEvent.keyboard('t');
      expect(state().feedView).toBe('table');
    });

    it('does nothing at a phone width, where the list is the only view', async () => {
      stubViewportWidth(720);
      renderKeys();

      await userEvent.keyboard('t');

      expect(state().feedView).toBe('list');
    });

    it('does nothing on a video wall', async () => {
      act(() => useConsole.setState({ wall: 1 }));
      renderKeys();

      await userEvent.keyboard('t');

      expect(state().feedView).toBe('list');
    });

    it('is announced on the group while single-key shortcuts are on, and not while they are off', () => {
      renderKeys();
      expect(group()).toHaveAttribute('aria-keyshortcuts', 'T');

      act(() => useConsole.setState({ keyboardShortcuts: false }));
      expect(group()).not.toHaveAttribute('aria-keyshortcuts');
    });

    it('moves focus to the List option when it removes the table with focus in it', async () => {
      act(() => state().setFeedView('table'));
      renderKeys();
      screen.getByRole('button', { name: 'Row' }).focus();

      await userEvent.keyboard('t');

      expect(state().feedView).toBe('list');
      expect(radio('List')).toHaveFocus();
    });

    it('leaves focus where it is when focus is outside the table', async () => {
      renderKeys();
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
      elsewhere.focus();

      await userEvent.keyboard('t');
      expect(state().feedView).toBe('table');
      expect(elsewhere).toHaveFocus();

      await userEvent.keyboard('t');
      expect(state().feedView).toBe('list');
      expect(elsewhere).toHaveFocus();
    });
  });
});
