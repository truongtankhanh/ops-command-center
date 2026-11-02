import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
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

  // V3-07.4: the chips are a look, so everything above holds for them too.
  describe('as chips', () => {
    const COUNTED: { value: Letter; label: string; count: number }[] = [
      { value: 'a', label: 'Alpha', count: 3 },
      { value: 'b', label: 'Beta', count: 0 },
      { value: 'c', label: 'Gamma', count: 12 },
    ];

    function ChipHarness() {
      const [value, setValue] = useState<Letter>('a');
      return (
        <Tabs label="Letters" tabs={COUNTED} value={value} onChange={setValue} appearance="chips">
          <button type="button">In the panel</button>
        </Tabs>
      );
    }

    it('marks the tab list as chips, and leaves the default list unmarked', () => {
      const { unmount } = render(<ChipHarness />);
      expect(screen.getByRole('tablist', { name: 'Letters' })).toHaveAttribute(
        'data-appearance',
        'chips',
      );
      unmount();

      render(<Harness />);
      expect(screen.getByRole('tablist', { name: 'Letters' })).not.toHaveAttribute(
        'data-appearance',
      );
    });

    it('keeps the roles, the counts in the names and the selection', async () => {
      render(<ChipHarness />);

      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(tab('Alpha 3')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Gamma 12')).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByRole('tabpanel', { name: 'Alpha 3' })).toBeInTheDocument();

      await userEvent.click(tab('Beta 0'));
      expect(tab('Beta 0')).toHaveAttribute('aria-selected', 'true');
    });

    it('keeps one Tab stop and the arrow keys, wrapping at the end', async () => {
      render(<ChipHarness />);

      expect(tab('Alpha 3')).toHaveAttribute('tabindex', '0');
      expect(tab('Beta 0')).toHaveAttribute('tabindex', '-1');

      await userEvent.click(tab('Gamma 12'));
      await userEvent.keyboard('{ArrowRight}');
      expect(tab('Alpha 3')).toHaveFocus();
      expect(tab('Alpha 3')).toHaveAttribute('aria-selected', 'true');
    });

    it('has no axe violations', async () => {
      render(<ChipHarness />);

      await expectNoAxeViolations();
    });
  });

  describe('reachablePanel', () => {
    /** The panel's content is a prop, so a case can hold text only, a control, or change between them. */
    function PanelHarness({
      content,
      reachablePanel = true,
    }: {
      content: ReactNode;
      reachablePanel?: boolean;
    }) {
      return (
        <Tabs
          label="Letters"
          tabs={TABS}
          value="a"
          onChange={() => {}}
          reachablePanel={reachablePanel}
        >
          {content}
        </Tabs>
      );
    }

    it('makes a panel with nothing focusable a Tab stop, right after the selected tab', async () => {
      render(<PanelHarness content={<p>Only text</p>} />);

      expect(screen.getByRole('tabpanel', { name: 'Alpha' })).toHaveAttribute('tabindex', '0');
      await userEvent.tab();
      expect(tab('Alpha')).toHaveFocus();
      await userEvent.tab();
      expect(screen.getByRole('tabpanel', { name: 'Alpha' })).toHaveFocus();
    });

    it('leaves a panel with a focusable control alone', () => {
      render(<PanelHarness content={<button type="button">In the panel</button>} />);

      expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex');
    });

    it('does not count a disabled control or a control taken out of the Tab order', () => {
      render(
        <PanelHarness
          content={
            <>
              <button type="button" disabled>
                Off
              </button>
              <button type="button" tabIndex={-1}>
                Skipped
              </button>
            </>
          }
        />,
      );

      expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
    });

    it('follows the content when a control appears in it and when it goes', async () => {
      function Changing() {
        const [loaded, setLoaded] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setLoaded((value) => !value)}>
              Switch
            </button>
            <PanelHarness
              content={loaded ? <button type="button">Loaded</button> : <p>Loading</p>}
            />
          </>
        );
      }
      render(<Changing />);
      expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');

      await userEvent.click(screen.getByRole('button', { name: 'Switch' }));
      await waitFor(() => expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex'));

      await userEvent.click(screen.getByRole('button', { name: 'Switch' }));
      await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0'));
    });

    it('is off by default', () => {
      render(<PanelHarness content={<p>Only text</p>} reachablePanel={false} />);

      expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex');
    });

    it('has no axe violations on a panel that is a Tab stop', async () => {
      render(<PanelHarness content={<p>Only text</p>} />);

      await expectNoAxeViolations();
    });
  });

  describe('when a tab is no longer offered', () => {
    /** The consumer owns the selection, as the frame does: it passes the tabs and the selected one. */
    const Offered = ({ tabs, value }: { tabs: typeof TABS; value: Letter }) => (
      <>
        <button type="button">Outside</button>
        <Tabs label="Letters" tabs={tabs} value={value} onChange={() => {}}>
          <p>Showing {value}</p>
        </Tabs>
      </>
    );

    it('moves focus to the selected tab when the tab that had focus goes', async () => {
      const { rerender } = render(<Offered tabs={TABS} value="c" />);
      await userEvent.click(tab('Gamma'));
      expect(tab('Gamma')).toHaveFocus();

      rerender(<Offered tabs={TABS.slice(0, 2)} value="a" />);

      expect(screen.queryByRole('tab', { name: 'Gamma' })).toBeNull();
      expect(tab('Alpha')).toHaveFocus();
      expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
    });

    it('leaves focus where it is when it was not on the tab that goes', async () => {
      const { rerender } = render(<Offered tabs={TABS} value="a" />);
      await userEvent.click(screen.getByRole('button', { name: 'Outside' }));

      rerender(<Offered tabs={TABS.slice(0, 2)} value="a" />);

      expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    });

    it('does not take focus back from the page when the focused tab only re-renders', async () => {
      const { rerender } = render(<Offered tabs={TABS} value="b" />);
      await userEvent.click(tab('Beta'));
      (document.activeElement as HTMLElement).blur();

      rerender(<Offered tabs={TABS} value="b" />);

      expect(document.body).toHaveFocus();
    });
  });
});
