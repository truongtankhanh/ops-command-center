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

  // V3-07.2: the severity is a visible word and a glyph on the chip, and the row's name says it once.
  describe('severity', () => {
    it('is drawn as a word next to a decorative glyph, and the row reads it once', () => {
      renderWithQueryClient(<IncidentRow incident={incident} zone="Main Gate" now={NOW} />);

      const chip = screen.getByText('Critical');
      expect(chip).toHaveAttribute('data-severity', 'critical');
      // The words are drawn by the chip and said by the row's own text, so the chip is hidden from the name.
      expect(chip).toHaveAttribute('aria-hidden', 'true');
      expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      const row = screen.getByRole('button', { name: /Critical severity,/ });
      expect(row.textContent?.match(/severity/g)).toHaveLength(1);
    });

    it('is a word and a glyph for every severity, Low included', () => {
      renderWithQueryClient(
        <>
          <IncidentRow incident={{ ...incident, id: 'low', severity: 'low' }} now={NOW} />
          <IncidentRow incident={{ ...incident, id: 'med', severity: 'medium' }} now={NOW} />
        </>,
      );

      for (const word of ['Low', 'Medium']) {
        expect(screen.getByText(word).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      }
    });

    it('stays on a resolved row, which only loses its hue', () => {
      renderWithQueryClient(
        <IncidentRow incident={{ ...incident, status: 'resolved' }} now={NOW} />,
      );

      const row = screen.getByRole('button', { name: /Critical severity,/ });
      expect(row).toHaveAttribute('data-status', 'resolved');
      expect(screen.getByText('Critical').querySelector('svg')).not.toBeNull();
    });
  });

  it('keeps the name in the order severity, type, title, age, status, zone and code', () => {
    renderWithQueryClient(<IncidentRow incident={incident} zone="Main Gate" now={NOW} />);

    expect(
      screen.getByRole('button', {
        name: /Critical severity,\s*Fire alarm:\s*Smoke in the stairwell\s*5m,\s*past attention time\s*Open\s*Main Gate\s*INC-000042/,
      }),
    ).toBeInTheDocument();
  });

  it('reads a category tag with the row, between the zone and the code', () => {
    renderWithQueryClient(
      <IncidentRow incident={incident} zone="Main Gate" tag="Fire safety" now={NOW} />,
    );

    expect(
      screen.getByRole('button', { name: /Main Gate\s*Fire safety\s*INC-000042/ }),
    ).toBeInTheDocument();
  });

  describe('selection', () => {
    it('marks the selected row with aria-current, and a second click deselects it', async () => {
      renderWithQueryClient(<IncidentRow incident={incident} now={NOW} />);
      const row = screen.getByRole('button');
      expect(row).toHaveAttribute('aria-current', 'false');

      await userEvent.click(row);
      expect(row).toHaveAttribute('aria-current', 'true');

      await userEvent.click(row);
      expect(row).toHaveAttribute('aria-current', 'false');
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });
  });

  describe('age', () => {
    it('shows a clock, the late flag and the hidden words on an open row past its attention time', () => {
      renderWithQueryClient(<IncidentRow incident={incident} now={NOW} />);

      const age = screen.getByText('5m', { exact: false });
      expect(age).toHaveAttribute('data-late', 'true');
      expect(age.querySelector('svg')).not.toBeNull();
      expect(screen.getByText(/past attention time/)).toBeInTheDocument();
    });

    it('is not late once the incident is acknowledged', () => {
      renderWithQueryClient(
        <IncidentRow incident={{ ...incident, status: 'acknowledged' }} now={NOW} />,
      );

      expect(screen.getByText('5m')).toHaveAttribute('data-late', 'false');
      expect(screen.queryByText(/past attention time/)).toBeNull();
    });
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
      const { container } = renderWithQueryClient(
        <IncidentRow incident={incident} zone="Main Gate" now={NOW} readOnly />,
      );

      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(container).toHaveTextContent(/Critical\s*severity,/);
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
