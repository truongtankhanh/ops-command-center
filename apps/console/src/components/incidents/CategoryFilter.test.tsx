import { INCIDENT_CATEGORIES, type IncidentCategory } from '@occ/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { categoryLabel } from '../../lib/incidents/incidents';
import { expectNoAxeViolations } from '../../test-utils';
import { CategoryFilter } from './CategoryFilter';

function renderFilter(category: IncidentCategory | null = null) {
  const onChange = vi.fn();
  const triggerRef = createRef<HTMLButtonElement>();
  render(<CategoryFilter category={category} onChange={onChange} triggerRef={triggerRef} />);
  return { onChange, triggerRef };
}

const trigger = () => screen.getByRole('button', { name: 'Filter by category' });
/** Role queries skip the hidden panel, so `null` means closed. */
const panel = () => screen.queryByRole('group', { name: 'Filter incidents by category' });
const option = (category: IncidentCategory) =>
  screen.getByRole('button', { name: categoryLabel(category) });

describe('CategoryFilter', () => {
  it('names the button and the panel differently, and starts closed', () => {
    renderFilter();

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toBeNull();
  });

  it('hands its button to triggerRef', () => {
    const { triggerRef } = renderFilter();

    expect(triggerRef.current).toBe(trigger());
  });

  it('lists the six categories in contract order, none pressed without a choice', async () => {
    renderFilter();

    await userEvent.click(trigger());

    const names = INCIDENT_CATEGORIES.map(categoryLabel);
    const buttons = screen
      .getAllByRole('button')
      .filter((button) => names.includes(button.textContent ?? ''));
    expect(buttons.map((button) => button.textContent)).toEqual(names);
    for (const category of INCIDENT_CATEGORIES) {
      expect(option(category)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('marks the chosen category as pressed, and only that one', async () => {
    renderFilter('facilities');

    await userEvent.click(trigger());

    expect(option('facilities')).toHaveAttribute('aria-pressed', 'true');
    expect(option('security')).toHaveAttribute('aria-pressed', 'false');
  });

  it('chooses a category, closes the panel and puts focus back on the button', async () => {
    const { onChange } = renderFilter();
    await userEvent.click(trigger());

    await userEvent.click(option('security'));

    expect(onChange).toHaveBeenCalledWith('security');
    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('clears the category when the pressed one is chosen again', async () => {
    const { onChange } = renderFilter('traffic');
    await userEvent.click(trigger());

    await userEvent.click(option('traffic'));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(panel()).toBeNull();
  });

  it('has a Clear that is off while nothing is chosen', async () => {
    renderFilter();
    await userEvent.click(trigger());

    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });

  it('clears and closes from Clear', async () => {
    const { onChange } = renderFilter('medical');
    await userEvent.click(trigger());

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(panel()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('has no axe violations, closed, open and with a choice', async () => {
    renderFilter('environment');
    await expectNoAxeViolations();

    await userEvent.click(trigger());

    expect(panel()).not.toBeNull();
    await expectNoAxeViolations();
  });
});
