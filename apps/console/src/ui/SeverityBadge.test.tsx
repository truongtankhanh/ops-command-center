import { INCIDENT_SEVERITIES } from '@occ/contracts';
import { render, screen } from '@testing-library/react';
import { severityLabel } from '../lib/incidents';
import { SeverityBadge } from './SeverityBadge';

describe('SeverityBadge', () => {
  it.each(INCIDENT_SEVERITIES)('shows %s as text next to a decorative icon', (severity) => {
    const { container } = render(<SeverityBadge severity={severity} />);

    const badge = screen.getByText(severityLabel(severity));
    expect(badge).toHaveAttribute('data-severity', severity);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it("keeps the caller's class", () => {
    render(<SeverityBadge severity="high" className="spaced" />);

    expect(screen.getByText('High')).toHaveClass('spaced');
  });
});
