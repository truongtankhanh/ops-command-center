import { INCIDENT_SEVERITIES } from '@occ/contracts';
import { render, screen } from '@testing-library/react';
import { severityLabel } from '../lib/incidents/incidents';
import { SeverityBadge } from './SeverityBadge';

describe('SeverityBadge', () => {
  it.each(INCIDENT_SEVERITIES)('shows %s as text next to a decorative icon', (severity) => {
    const { container } = render(<SeverityBadge severity={severity} />);

    const badge = screen.getByText(severityLabel(severity));
    expect(badge).toHaveAttribute('data-severity', severity);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  // Low has no hue of its own (a neutral steel), so the word and the glyph are what find it.
  it('shows Low as the word and one decorative glyph, since its colour is neutral', () => {
    const { container } = render(<SeverityBadge severity="low" />);

    const badge = screen.getByText('Low');
    expect(badge).toHaveAttribute('data-severity', 'low');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  // The compact chip of a feed row (V3-07.2): the same word and glyph, marked small; the default carries no size.
  it('marks the compact size and leaves the default unmarked', () => {
    const { container } = render(
      <>
        <SeverityBadge severity="high" size="s" />
        <SeverityBadge severity="medium" />
      </>,
    );

    const compact = screen.getByText('High');
    expect(compact).toHaveAttribute('data-size', 's');
    expect(compact.querySelectorAll('svg')).toHaveLength(1);
    expect(compact.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Medium')).not.toHaveAttribute('data-size');
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('is hidden from assistive tech only when the caller says it is decorative', () => {
    render(
      <>
        <SeverityBadge severity="high" decorative />
        <SeverityBadge severity="medium" />
      </>,
    );

    expect(screen.getByText('High')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Medium')).not.toHaveAttribute('aria-hidden');
  });

  it("keeps the caller's class", () => {
    render(<SeverityBadge severity="high" className="spaced" />);

    expect(screen.getByText('High')).toHaveClass('spaced');
  });
});
