import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../test-utils';
import { Icon } from './Icon';
import { Box } from './icons';
import { InspectorHeader } from './InspectorHeader';

const close = <button type="button">Close</button>;

const follows = (before: HTMLElement, after: HTMLElement) =>
  Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('InspectorHeader', () => {
  it('heads the sheet with the title, as a level-2 heading', () => {
    render(<InspectorHeader title="Door forced open" closeButton={close} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Door forced open' })).toBeInTheDocument();
  });

  it('draws the line under the title', () => {
    render(
      <InspectorHeader
        title="Door forced open"
        subtitle={
          <>
            <span>INC-000108</span>
            <span aria-hidden="true">·</span>
            <span>Library</span>
          </>
        }
        closeButton={close}
      />,
    );

    const title = screen.getByRole('heading', { name: 'Door forced open' });
    expect(screen.getByText('INC-000108')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(follows(title, screen.getByText('INC-000108'))).toBe(true);
  });

  describe('the tile', () => {
    it('is hidden from assistive technology, since the words name the object', () => {
      render(
        <InspectorHeader
          tile={<Icon glyph={Box} size={22} />}
          title="Cooling tower 1"
          closeButton={close}
        />,
      );

      const tile = document.querySelector('[aria-hidden="true"] svg')?.parentElement;
      expect(tile).not.toBeNull();
      expect(tile).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('takes the severity as an attribute, and has none by default', () => {
      const { rerender } = render(
        <InspectorHeader
          tile={<Icon glyph={Box} size={22} />}
          severity="critical"
          title="Smoke"
          closeButton={close}
        />,
      );
      expect(document.querySelector('[data-severity="critical"]')).not.toBeNull();

      rerender(
        <InspectorHeader tile={<Icon glyph={Box} size={22} />} title="Smoke" closeButton={close} />,
      );
      expect(document.querySelector('[data-severity]')).toBeNull();
    });

    it('is not drawn without an icon', () => {
      render(<InspectorHeader title="Smoke" closeButton={close} />);

      expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    });
  });

  describe('the close control', () => {
    it('is the caller’s own element, after the title', () => {
      render(<InspectorHeader title="Smoke" closeButton={close} />);

      const button = screen.getByRole('button', { name: 'Close' });
      expect(follows(screen.getByRole('heading', { name: 'Smoke' }), button)).toBe(true);
    });

    it('is still there when there is no title to head', () => {
      render(<InspectorHeader closeButton={close} />);

      expect(screen.queryByRole('heading')).toBeNull();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
  });

  describe('the chips row', () => {
    it('holds the children in order, under the title', () => {
      render(
        <InspectorHeader title="Smoke" closeButton={close}>
          <span>Critical</span>
          <span>3m ago</span>
          <span>Open</span>
        </InspectorHeader>,
      );

      const critical = screen.getByText('Critical');
      const age = screen.getByText('3m ago');
      const status = screen.getByText('Open');
      expect(follows(screen.getByRole('heading', { name: 'Smoke' }), critical)).toBe(true);
      expect(follows(critical, age)).toBe(true);
      expect(follows(age, status)).toBe(true);
      // One row for all of them.
      expect(critical.parentElement).toBe(status.parentElement);
    });

    it('is not drawn without children', () => {
      const { container } = render(<InspectorHeader title="Smoke" closeButton={close} />);

      // The top row is the header's only child.
      expect(container.firstElementChild?.children).toHaveLength(1);
    });
  });

  it('keeps a long unbroken title and a long place in the header', () => {
    const token = 'x'.repeat(200);
    render(<InspectorHeader title={token} subtitle={<span>{token}</span>} closeButton={close} />);

    expect(screen.getByRole('heading', { name: token })).toBeInTheDocument();
    // The title and the place both: wrapping is the stylesheet's (jsdom has no layout).
    expect(screen.getAllByText(token)).toHaveLength(2);
  });

  describe('accessibility', () => {
    it('has no axe violations with everything', async () => {
      const { container } = render(
        <InspectorHeader
          tile={<Icon glyph={Box} size={22} />}
          severity="high"
          title="Smoke detector — Science Lab"
          subtitle={<span>INC-000110</span>}
          closeButton={close}
        >
          <span>High</span>
          <span>Open</span>
        </InspectorHeader>,
      );

      await expectNoAxeViolations(container);
    });

    it('has no axe violations with only the close control', async () => {
      const { container } = render(<InspectorHeader closeButton={close} />);

      await expectNoAxeViolations(container);
    });
  });
});
