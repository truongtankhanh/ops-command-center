import { render } from '@testing-library/react';
import { expectNoAxeViolations } from '../test-utils';
import { ScaleBar } from './ScaleBar';
import { writeScale } from './writeScale';

/** The bar's root: it is `aria-hidden`, so a role query cannot reach it. */
const rootOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;
const labelOf = (root: HTMLElement) => root.lastElementChild as HTMLElement;

describe('ScaleBar', () => {
  it('is decorative: hidden from assistive technology and with nothing to focus', () => {
    const { container } = render(<ScaleBar />);
    const root = rootOf(container);

    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
    expect(root).not.toHaveAttribute('tabindex');
  });

  it('shows nothing before the first reading', () => {
    const { container } = render(<ScaleBar />);

    expect(rootOf(container)).not.toHaveAttribute('data-ready');
    expect(labelOf(rootOf(container))).toHaveTextContent('');
  });

  it('hands its root to a ref and takes a class from the caller', () => {
    const ref = { current: null as HTMLDivElement | null };
    const { container } = render(<ScaleBar ref={ref} className="placed" />);

    expect(ref.current).toBe(rootOf(container));
    expect(rootOf(container)).toHaveClass('placed');
  });

  it('passes axe', async () => {
    const { container } = render(<ScaleBar />);
    writeScale(rootOf(container), { label: '50 m', widthPx: 96 });

    await expectNoAxeViolations(container);
  });
});

describe('writeScale', () => {
  it('writes the width in whole pixels and the label, and marks the bar ready', () => {
    const { container } = render(<ScaleBar />);
    const root = rootOf(container);

    writeScale(root, { label: '≈ 50 m', widthPx: 99.6 });

    expect(root).toHaveAttribute('data-ready');
    expect(root.style.getPropertyValue('--scale-bar-width')).toBe('100px');
    expect(labelOf(root)).toHaveTextContent('≈ 50 m');
  });

  it('follows the width step by step while the label stays put', () => {
    const { container } = render(<ScaleBar />);
    const root = rootOf(container);
    writeScale(root, { label: '100 m', widthPx: 113 });
    const labelNode = labelOf(root).firstChild;

    writeScale(root, { label: '100 m', widthPx: 117 });

    expect(root.style.getPropertyValue('--scale-bar-width')).toBe('117px');
    // The same text node: the label was not written again.
    expect(labelOf(root).firstChild).toBe(labelNode);
  });

  it('writes nothing when the reading has not changed', () => {
    const { container } = render(<ScaleBar />);
    const root = rootOf(container);
    writeScale(root, { label: '50 m', widthPx: 96 });
    const labelNode = labelOf(root).firstChild;
    const setProperty = vi.spyOn(root.style, 'setProperty');

    writeScale(root, { label: '50 m', widthPx: 96.4 });

    expect(setProperty).not.toHaveBeenCalled();
    expect(labelOf(root).firstChild).toBe(labelNode);
  });

  it('changes the label when the length changes', () => {
    const { container } = render(<ScaleBar />);
    const root = rootOf(container);
    writeScale(root, { label: '50 m', widthPx: 60 });

    writeScale(root, { label: '100 m', widthPx: 120 });

    expect(labelOf(root)).toHaveTextContent('100 m');
    expect(root.style.getPropertyValue('--scale-bar-width')).toBe('120px');
  });

  it('hides the bar for no reading and shows it again for the next one', () => {
    const { container } = render(<ScaleBar />);
    const root = rootOf(container);
    writeScale(root, { label: '50 m', widthPx: 96 });

    writeScale(root, null);
    expect(root).not.toHaveAttribute('data-ready');

    writeScale(root, { label: '50 m', widthPx: 96 });
    expect(root).toHaveAttribute('data-ready');
  });

  it('ignores a bar that is not there', () => {
    expect(() => writeScale(null, { label: '50 m', widthPx: 96 })).not.toThrow();
    expect(() => writeScale(null, null)).not.toThrow();
  });
});
