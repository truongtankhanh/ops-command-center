import { render, screen } from '@testing-library/react';
import { Icon } from './Icon';
import { severityIcon, X } from './icons';

describe('Icon', () => {
  it('is hidden from assistive tech when it has no label', () => {
    const { container } = render(<Icon glyph={severityIcon('critical')} />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('treats an empty label as no label', () => {
    const { container } = render(<Icon glyph={X} label="" />);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is an image with that name when it has a label', () => {
    render(<Icon glyph={X} label="Close" />);

    const img = screen.getByRole('img', { name: 'Close' });
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  it('names an icon-only button through its label', () => {
    render(
      <button type="button">
        <Icon glyph={X} label="Close" />
      </button>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('draws at 18 px by default and at the size it is given', () => {
    const { container, rerender } = render(<Icon glyph={X} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '18');
    expect(container.querySelector('svg')).toHaveAttribute('height', '18');

    rerender(<Icon glyph={X} size={14} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '14');
    expect(container.querySelector('svg')).toHaveAttribute('height', '14');
  });

  it("keeps the caller's class", () => {
    const { container } = render(<Icon glyph={X} className="tint" />);

    expect(container.querySelector('svg')).toHaveClass('tint');
  });
});
