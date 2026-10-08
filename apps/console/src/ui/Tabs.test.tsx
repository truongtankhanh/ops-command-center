import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expectNoAxeViolations } from '../test-utils';
import { Tabs } from './Tabs';

type Letter = 'a' | 'b' | 'c';

const TABS: { value: Letter; label: string }[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

/** Controlled like the feed: the selection lives outside `Tabs`. */
function Harness({ initial = 'a' }: { initial?: Letter }) {
  const [value, setValue] = useState<Letter>(initial);
  return (
    <Tabs label="Letters" tabs={TABS} value={value} onChange={setValue}>
      <p>Showing {value}</p>
      <button type="button">In the panel</button>
    </Tabs>
  );
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('Tabs', () => {
  it('renders a named tab list with the selected tab marked', () => {
    render(<Harness initial="b" />);

    expect(screen.getByRole('tablist', { name: 'Letters' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(tab('Beta')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'false');
  });

  it('is a single Tab stop on the selected tab', async () => {
    render(<Harness initial="b" />);

    expect(tab('Beta')).toHaveAttribute('tabindex', '0');
    expect(tab('Alpha')).toHaveAttribute('tabindex', '-1');
    expect(tab('Gamma')).toHaveAttribute('tabindex', '-1');

    await userEvent.tab();
    expect(tab('Beta')).toHaveFocus();

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'In the panel' })).toHaveFocus();
  });

  it('selects and focuses the next tab with ArrowRight, wrapping at the end', async () => {
    render(<Harness initial="b" />);
    await userEvent.tab();

    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Gamma')).toHaveFocus();
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Showing c')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Alpha')).toHaveFocus();
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects and focuses the previous tab with ArrowLeft, wrapping at the start', async () => {
    render(<Harness initial="a" />);
    await userEvent.tab();

    await userEvent.keyboard('{ArrowLeft}');
    expect(tab('Gamma')).toHaveFocus();
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the first and last tab with Home and End', async () => {
    render(<Harness initial="b" />);
    await userEvent.tab();

    await userEvent.keyboard('{End}');
    expect(tab('Gamma')).toHaveFocus();
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Home}');
    expect(tab('Alpha')).toHaveFocus();
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores keys that are not tab-list keys', async () => {
    const onChange = vi.fn();
    render(
      <Tabs label="Letters" tabs={TABS} value="a" onChange={onChange}>
        content
      </Tabs>,
    );
    await userEvent.tab();

    await userEvent.keyboard('{ArrowDown}x');

    expect(onChange).not.toHaveBeenCalled();
    expect(tab('Alpha')).toHaveFocus();
  });

  it('selects a tab on click', async () => {
    render(<Harness />);

    await userEvent.click(tab('Gamma'));

    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Showing c')).toBeInTheDocument();
  });

  it('wraps the content in one panel, labelled by the selected tab', async () => {
    render(<Harness />);

    const panel = screen.getByRole('tabpanel', { name: 'Alpha' });
    expect(panel).toHaveTextContent('Showing a');
    for (const each of screen.getAllByRole('tab')) {
      expect(each).toHaveAttribute('aria-controls', panel.id);
    }

    await userEvent.click(tab('Beta'));
    expect(screen.getByRole('tabpanel', { name: 'Beta' })).toBe(panel);
  });

  it('keeps the first tab reachable when the value matches no tab', () => {
    render(
      <Tabs
        label="Letters"
        tabs={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        value="z"
        onChange={() => {}}
      >
        content
      </Tabs>,
    );

    expect(tab('Alpha')).toHaveAttribute('tabindex', '0');
    expect(screen.queryAllByRole('tab', { selected: true })).toHaveLength(0);
  });

  it("shows a count and makes it part of the tab's name", () => {
    render(
      <Tabs
        label="Letters"
        tabs={[
          { value: 'a', label: 'Alpha', count: 3 },
          { value: 'b', label: 'Beta', count: 0 },
        ]}
        value="a"
        onChange={() => {}}
      >
        content
      </Tabs>,
    );

    // The space is part of the name: "Alpha 3", not "Alpha3".
    expect(tab('Alpha 3')).toBeInTheDocument();
    expect(tab('Beta 0')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Alpha 3' })).toHaveTextContent('content');
  });

  // UI-16: automated accessibility check of the tab list, its counts and the panel.
  it('has no axe violations, with counts in the tab names', async () => {
    render(
      <Tabs
        label="Letters"
        tabs={[
          { value: 'a', label: 'Alpha', count: 3 },
          { value: 'b', label: 'Beta', count: 0 },
        ]}
        value="a"
        onChange={() => {}}
      >
        <button type="button">In the panel</button>
      </Tabs>,
    );

    await expectNoAxeViolations();
  });
});
