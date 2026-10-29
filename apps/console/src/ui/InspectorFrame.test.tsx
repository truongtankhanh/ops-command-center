import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { expectNoAxeViolations } from '../test-utils';
import { InspectorFrame, type InspectorTab } from './InspectorFrame';

type Section = 'details' | 'related' | 'timeline';

const DETAILS: InspectorTab<Section> = {
  value: 'details',
  label: 'Details',
  content: <p>Details content</p>,
};
const RELATED: InspectorTab<Section> = {
  value: 'related',
  label: 'Related',
  count: 3,
  content: <p>Related content</p>,
};
const TIMELINE: InspectorTab<Section> = {
  value: 'timeline',
  label: 'Timeline',
  content: <p>Timeline content</p>,
};

function renderFrame(
  tabs: readonly InspectorTab<Section>[],
  props: Partial<Parameters<typeof InspectorFrame<Section>>[0]> = {},
) {
  const onEscape = vi.fn();
  const view = render(
    <InspectorFrame
      label="Thing 1"
      onEscape={onEscape}
      header={<h2>The header</h2>}
      tabsLabel="Thing sections"
      tabs={tabs}
      foot={<button type="button">The foot</button>}
      {...props}
    />,
  );
  return { ...view, onEscape };
}

const sheet = () => screen.getByRole('complementary', { name: 'Thing 1' });
const tab = (name: string) => screen.getByRole('tab', { name });
const follows = (before: HTMLElement, after: HTMLElement) =>
  Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('InspectorFrame', () => {
  describe('with one tab', () => {
    it('draws the header, the content and the foot in the sheet, in that order', () => {
      renderFrame([DETAILS]);

      const header = within(sheet()).getByRole('heading', { name: 'The header' });
      const content = within(sheet()).getByText('Details content');
      const foot = within(sheet()).getByRole('button', { name: 'The foot' });
      expect(follows(header, content)).toBe(true);
      expect(follows(content, foot)).toBe(true);
    });

    it('draws no tab list and no tab panel', () => {
      renderFrame([DETAILS]);

      expect(screen.queryByRole('tablist')).toBeNull();
      expect(screen.queryByRole('tab')).toBeNull();
      expect(screen.queryByRole('tabpanel')).toBeNull();
    });

    it('keeps the foot a direct child of the sheet, so it can stick to the sheet', () => {
      renderFrame([DETAILS]);

      expect(screen.getByRole('button', { name: 'The foot' }).parentElement).toBe(sheet());
    });

    it('draws nothing between the header and the foot when there are no tabs', () => {
      renderFrame([]);

      expect(within(sheet()).getByRole('heading', { name: 'The header' })).toBeInTheDocument();
      expect(within(sheet()).getByRole('button', { name: 'The foot' })).toBeInTheDocument();
      expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('needs no foot', () => {
      renderFrame([DETAILS], { foot: undefined });

      expect(screen.queryByRole('button', { name: 'The foot' })).toBeNull();
      expect(screen.getByText('Details content')).toBeInTheDocument();
    });
  });

  describe('with several tabs', () => {
    it('draws a named tab list with the first tab selected and its content in one panel', () => {
      renderFrame([DETAILS, RELATED, TIMELINE]);

      expect(screen.getByRole('tablist', { name: 'Thing sections' })).toBeInTheDocument();
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(tab('Details')).toHaveAttribute('aria-selected', 'true');
      const panel = screen.getByRole('tabpanel', { name: 'Details' });
      expect(within(panel).getByText('Details content')).toBeInTheDocument();
      expect(screen.queryByText('Related content')).toBeNull();
      expect(screen.queryByText('Timeline content')).toBeNull();
    });

    it("makes a tab's count part of its name", () => {
      renderFrame([DETAILS, RELATED]);

      expect(tab('Related 3')).toBeInTheDocument();
    });

    it('shows the content of the tab that is clicked, and names the panel by it', async () => {
      renderFrame([DETAILS, RELATED, TIMELINE]);

      await userEvent.click(tab('Timeline'));

      expect(tab('Timeline')).toHaveAttribute('aria-selected', 'true');
      const panel = screen.getByRole('tabpanel', { name: 'Timeline' });
      expect(within(panel).getByText('Timeline content')).toBeInTheDocument();
      expect(screen.queryByText('Details content')).toBeNull();
    });

    // The arrow keys, Home / End and wrapping are `Tabs.test.tsx`'s; this proves they are wired.
    it('moves between tabs with the arrow keys, as one Tab stop', async () => {
      renderFrame([DETAILS, RELATED, TIMELINE]);

      await userEvent.tab();
      expect(tab('Details')).toHaveFocus();
      await userEvent.keyboard('{ArrowRight}');

      expect(tab('Related 3')).toHaveFocus();
      expect(tab('Related 3')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Related content')).toBeInTheDocument();
      expect(tab('Details')).toHaveAttribute('tabindex', '-1');
    });

    it('keeps the foot outside the tab panel, and in place when the tab changes', async () => {
      renderFrame([DETAILS, RELATED]);
      const foot = screen.getByRole('button', { name: 'The foot' });
      expect(screen.getByRole('tabpanel')).not.toContainElement(foot);
      expect(follows(screen.getByRole('tabpanel'), foot)).toBe(true);

      await userEvent.click(tab('Related 3'));

      expect(screen.getByRole('button', { name: 'The foot' })).toBe(foot);
      expect(screen.getByRole('tabpanel')).not.toContainElement(foot);
    });

    it('falls back to the first tab when the selected one is no longer offered', async () => {
      const { rerender, onEscape } = renderFrame([DETAILS, RELATED, TIMELINE]);
      await userEvent.click(tab('Timeline'));

      rerender(
        <InspectorFrame
          label="Thing 1"
          onEscape={onEscape}
          header={<h2>The header</h2>}
          tabsLabel="Thing sections"
          tabs={[DETAILS, RELATED]}
        />,
      );

      expect(screen.getByText('Details content')).toBeInTheDocument();
      expect(tab('Details')).toHaveAttribute('aria-selected', 'true');
    });

    it('goes from one tab to a list as soon as a second tab is offered', () => {
      const { rerender, onEscape } = renderFrame([DETAILS]);
      expect(screen.queryByRole('tablist')).toBeNull();

      rerender(
        <InspectorFrame
          label="Thing 1"
          onEscape={onEscape}
          header={<h2>The header</h2>}
          tabsLabel="Thing sections"
          tabs={[DETAILS, RELATED]}
        />,
      );

      expect(screen.getByRole('tablist', { name: 'Thing sections' })).toBeInTheDocument();
      expect(screen.getByText('Details content')).toBeInTheDocument();
    });
  });

  describe('as the sheet', () => {
    it('focuses the sheet when it opens, named by its label', () => {
      renderFrame([DETAILS]);

      expect(sheet()).toHaveFocus();
    });

    it('gives the sheet element to its ref', () => {
      const ref = createRef<HTMLElement>();
      renderFrame([DETAILS], { ref });

      expect(ref.current).toBe(sheet());
    });

    it('calls onEscape for Escape, and not for another key', () => {
      const { onEscape } = renderFrame([DETAILS]);

      fireEvent.keyDown(sheet(), { key: 'Enter' });
      expect(onEscape).not.toHaveBeenCalled();
      fireEvent.keyDown(sheet(), { key: 'Escape' });

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('keeps the sheet open while something is kept, and says so', () => {
      const onEscapeKept = vi.fn();
      const { onEscape } = renderFrame([DETAILS], {
        keepOpen: true,
        keptMessage: 'Esc keeps your note.',
        onEscapeKept,
      });

      fireEvent.keyDown(sheet(), { key: 'Escape' });

      expect(onEscape).not.toHaveBeenCalled();
      expect(onEscapeKept).toHaveBeenCalledTimes(1);
      expect(within(sheet()).getByRole('status')).toHaveTextContent('Esc keeps your note.');
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with one tab', async () => {
      renderFrame([DETAILS]);

      await expectNoAxeViolations();
    });

    it('has no axe violations with several tabs, a count included', async () => {
      renderFrame([DETAILS, RELATED, TIMELINE]);

      await expectNoAxeViolations();
    });
  });
});
