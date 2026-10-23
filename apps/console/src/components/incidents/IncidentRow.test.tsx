import type { Incident } from '@occ/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConsole } from '../../store';
import { renderWithQueryClient, resetStore } from '../../test-utils';
import { IncidentRow } from './IncidentRow';

const incident: Incident = {
  id: 'i1',
  code: 'INC-000042',
  type: 'fire_alarm',
  severity: 'critical',
  status: 'open',
  title: 'Smoke in the stairwell',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-08T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const NOW = Date.parse('2026-10-08T08:05:00.000Z');

describe('IncidentRow', () => {
  beforeEach(() => resetStore(useConsole));

  it('is a button that selects the incident, as in the feed', async () => {
    renderWithQueryClient(<IncidentRow incident={incident} zone="Main Gate" now={NOW} />);

    await userEvent.click(screen.getByRole('button'));

    expect(useConsole.getState().selectedIncidentId).toBe('i1');
  });

  // The video wall's row (V2-21.5): the same words, and nothing to press.
  describe('read only', () => {
    it('is not a button, and has no tab stop', () => {
      const { container } = renderWithQueryClient(
        <IncidentRow incident={incident} zone="Main Gate" now={NOW} readOnly />,
      );

      expect(screen.queryByRole('button')).toBeNull();
      expect(container.querySelectorAll('button, a[href], input, [tabindex]')).toHaveLength(0);
    });

    it('says the same: the severity, the type, the title, the zone, the status and the code', () => {
      renderWithQueryClient(
        <IncidentRow incident={incident} zone="Main Gate" now={NOW} readOnly />,
      );

      expect(screen.getByText(/Critical severity/)).toBeInTheDocument();
      expect(screen.getByText(/Smoke in the stairwell/)).toBeInTheDocument();
      expect(screen.getByText('Main Gate')).toBeInTheDocument();
      expect(screen.getByText('INC-000042')).toBeInTheDocument();
    });

    it('selects nothing when it is clicked', async () => {
      renderWithQueryClient(<IncidentRow incident={incident} now={NOW} readOnly />);

      await userEvent.click(screen.getByText('Smoke in the stairwell', { exact: false }));

      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('is fresh for as long as the wall holds the incident in focus', () => {
      const { container, rerender } = renderWithQueryClient(
        <IncidentRow incident={incident} now={NOW} readOnly />,
      );
      const row = () => container.querySelector('[data-readonly]');
      expect(row()).toHaveAttribute('data-fresh', 'false');

      useConsole.setState({ wallFocusId: 'i1' });
      rerender(<IncidentRow incident={incident} now={NOW} readOnly />);

      expect(row()).toHaveAttribute('data-fresh', 'true');
    });
  });
});
