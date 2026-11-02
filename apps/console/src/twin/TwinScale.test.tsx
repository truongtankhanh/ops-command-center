import { render } from '@testing-library/react';
import { createRef } from 'react';
import { writeScale } from '../ui/writeScale';
import { TwinScale } from './TwinScale';

describe('TwinScale', () => {
  it('is a decorative bar that shows nothing until the canvas writes a reading', () => {
    const { container } = render(<TwinScale scaleRef={createRef<HTMLDivElement>()} />);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).not.toHaveAttribute('data-ready');
  });

  it('hands its root to the ref the canvas writes through and takes a class from the stage', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<TwinScale scaleRef={ref} className="placed" />);

    expect(ref.current).toBe(container.firstElementChild);
    expect(ref.current).toHaveClass('placed');
  });

  it('shows what the canvas writes, marked as an approximation', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<TwinScale scaleRef={ref} />);

    writeScale(ref.current, { label: '≈ 50 m', widthPx: 96 });

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-ready');
    expect(root).toHaveTextContent('≈ 50 m');
    expect(root.style.getPropertyValue('--scale-bar-width')).toBe('96px');
  });

  it('keeps what was written when the stage re-renders', () => {
    const ref = createRef<HTMLDivElement>();
    const { container, rerender } = render(<TwinScale scaleRef={ref} />);
    writeScale(ref.current, { label: '≈ 20 m', widthPx: 80 });

    rerender(<TwinScale scaleRef={ref} />);

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-ready');
    expect(root).toHaveTextContent('≈ 20 m');
  });
});
