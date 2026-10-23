import type { Role } from '@occ/contracts';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from '../../auth/store';
import { useConsole } from '../../store';
import { expectNoAxeViolations, resetStore } from '../../test-utils';
import { ColourBy } from './ColourBy';

const TRIGGER = 'Colour by Indoor temperature';

const trigger = () => screen.getByRole('button', { name: TRIGGER });
const listbox = () => screen.getByRole('listbox', { name: 'Colour by' });
const queryTrigger = () => screen.queryByRole('button', { name: /Colour by/ });
const heatOn = () => act(() => useConsole.getState().toggleLayer('heat'));

describe('ColourBy (V2-17.4)', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useSession);
  });

  describe('when it is shown', () => {
    it('draws nothing while Heat is off', () => {
      render(<ColourBy />);

      expect(queryTrigger()).toBeNull();
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('draws the button at the campus level once Heat is on, and not before', () => {
      render(<ColourBy />);

      heatOn();

      expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    });

    it('draws the button with a building in focus', () => {
      heatOn();
      act(() => useConsole.getState().focusBuilding('BLD-DC'));
      render(<ColourBy />);

      expect(trigger()).toBeInTheDocument();
    });

    // Heat draws nothing different there (ADR-0020 "Settled in V2-17.3"), so a control for it would do nothing.
    it('draws nothing with an asset isolated or one of its parts, and comes back after', () => {
      heatOn();
      render(<ColourBy />);

      act(() => useConsole.getState().selectAsset('UPS-01', 'BLD-DC'));
      expect(queryTrigger()).toBeNull();

      act(() => useConsole.getState().selectPart('Door'));
      expect(queryTrigger()).toBeNull();

      act(() => useConsole.getState().goCampus());
      expect(trigger()).toBeInTheDocument();
    });

    it('goes when Heat is turned off, and starts closed when it comes back', async () => {
      const user = userEvent.setup();
      heatOn();
      render(<ColourBy />);
      await user.click(trigger());
      expect(listbox()).toBeVisible();

      heatOn();
      expect(queryTrigger()).toBeNull();

      heatOn();
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('the button and the list', () => {
    beforeEach(() => heatOn());

    it('names the measure in words, and the list is closed and out of the tree', () => {
      render(<ColourBy />);

      expect(trigger()).toHaveAccessibleName(TRIGGER);
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(screen.queryByRole('option')).toBeNull();
      expect(trigger()).toHaveAttribute('aria-controls');
    });

    it('lists the one measure, selected, and the button points at the list', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);

      await user.click(trigger());

      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(trigger().getAttribute('aria-controls')).toBe(listbox().id);
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAccessibleName('Indoor temperature');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
    });

    it('moves focus into the list, with the option active', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);

      await user.click(trigger());

      expect(listbox()).toHaveFocus();
      expect(listbox()).toHaveAttribute(
        'aria-activedescendant',
        screen.getByRole('option').getAttribute('id'),
      );
    });

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
      ['ArrowDown', '{ArrowDown}'],
      ['ArrowUp', '{ArrowUp}'],
    ])('opens from the keyboard with %s', async (_name, keys) => {
      const user = userEvent.setup();
      render(<ColourBy />);

      await user.tab();
      expect(trigger()).toHaveFocus();
      await user.keyboard(keys);

      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(listbox()).toHaveFocus();
    });

    it('closes on a second press of the button', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);

      await user.click(trigger());
      await user.click(trigger());

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('keeps the one option active on the arrows, Home and End', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);
      await user.click(trigger());
      const active = listbox().getAttribute('aria-activedescendant');

      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}{Home}{End}');

      expect(listbox()).toHaveAttribute('aria-activedescendant', active);
      expect(listbox()).toBeVisible();
    });

    it('closes on Escape and gives focus back to the button', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);
      await user.click(trigger());

      await user.keyboard('{Escape}');

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(trigger()).toHaveFocus();
    });

    // The sheet, the search box, the part callout and the picking mode all act on Escape: an open list owns it.
    it('keeps Escape from reaching the rest of the page while it is open', async () => {
      const user = userEvent.setup();
      const onPageKey = vi.fn();
      window.addEventListener('keydown', onPageKey);
      render(<ColourBy />);
      await user.click(trigger());

      try {
        await user.keyboard('{Escape}');
        expect(onPageKey).not.toHaveBeenCalled();

        await user.keyboard('{Escape}');
        expect(onPageKey).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('keydown', onPageKey);
      }
    });

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('chooses the option with %s, closes and gives focus back', async (_name, keys) => {
      const user = userEvent.setup();
      render(<ColourBy />);
      await user.click(trigger());

      await user.keyboard(keys);

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(trigger()).toHaveFocus();
      expect(screen.getByRole('button', { name: TRIGGER })).toBeInTheDocument();
    });

    it('chooses the option with a click, and nothing else changes', async () => {
      const user = userEvent.setup();
      const before = useConsole.getState().layers;
      render(<ColourBy />);
      await user.click(trigger());

      await user.click(screen.getByRole('option'));

      expect(screen.queryByRole('listbox')).toBeNull();
      expect(trigger()).toHaveFocus();
      expect(useConsole.getState().layers).toEqual(before);
    });

    it('closes on Tab', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);
      await user.click(trigger());

      await user.tab();

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('closes on a press outside it', async () => {
      const user = userEvent.setup();
      render(
        <>
          <ColourBy />
          <button type="button">Elsewhere</button>
        </>,
      );
      await user.click(trigger());

      await user.click(screen.getByRole('button', { name: 'Elsewhere' }));

      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('stays open for a press inside it', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);
      await user.click(trigger());

      await user.pointer({ target: listbox(), keys: '[MouseLeft]' });

      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // Choosing what to draw is not an action on the site: the picker reads no session and no permission.
  describe('for every role', () => {
    it.each<Role>(['viewer', 'technician', 'operator'])('is the same for a %s', async (role) => {
      const user = userEvent.setup();
      act(() => useSession.getState().signedIn({ displayName: 'Someone', roles: [role] }));
      heatOn();
      render(<ColourBy />);

      await user.click(trigger());

      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('accessibility', () => {
    beforeEach(() => heatOn());

    it('has no violations closed', async () => {
      render(<ColourBy />);

      await expectNoAxeViolations();
    });

    it('has no violations open', async () => {
      const user = userEvent.setup();
      render(<ColourBy />);
      await user.click(trigger());

      await expectNoAxeViolations();
    });
  });
});
