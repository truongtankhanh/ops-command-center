import { INCIDENT_STATUSES } from '@occ/contracts';
import { render, screen } from '@testing-library/react';
import { statusLabel } from '../lib/incidents';
import { StatusChip } from './StatusChip';

describe('StatusChip', () => {
  it.each(INCIDENT_STATUSES)('shows %s as text next to a decorative icon', (status) => {
    const { container } = render(<StatusChip status={status} />);

    // The label is the chip's own text, so a query by text finds the chip itself.
    const chip = screen.getByText(statusLabel(status));
    expect(chip).toHaveAttribute('data-status', status);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is inline by default and a pill on request', () => {
    const { rerender } = render(<StatusChip status="open" />);
    expect(screen.getByText('Open')).not.toHaveAttribute('data-form');

    rerender(<StatusChip status="open" form="pill" />);
    expect(screen.getByText('Open')).toHaveAttribute('data-form', 'pill');
  });
});
