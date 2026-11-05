import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore, stubViewportWidth } from '../../test-utils';
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
});
