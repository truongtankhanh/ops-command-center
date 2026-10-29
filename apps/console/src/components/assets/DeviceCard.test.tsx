import type { AssetDetail, TelemetryPoint, Zone } from '@occ/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type DeviceInfoRow, deviceInfoRows } from '../../lib/assets/deviceInfo';
import { expectNoAxeViolations } from '../../test-utils';
import { DeviceCard } from './DeviceCard';

const NAME: DeviceInfoRow = { id: 'name', label: 'Device name', value: 'Smoke detector' };
const CODE: DeviceInfoRow = { id: 'code', label: 'Device ID', value: 'SD-0043' };
const CLASS: DeviceInfoRow = { id: 'class', label: 'Class', value: 'Smoke detector' };
const LOCATION: DeviceInfoRow = {
  id: 'location',
  label: 'Location',
  value: 'Science Lab · level 2',
};
const BASE = [NAME, CODE, CLASS];

const status = (state: Extract<DeviceInfoRow, { id: 'status' }>['state'], text: string) =>
  ({ id: 'status', label: 'Status', state, text }) satisfies DeviceInfoRow;
const battery = (percent: number | null, text: string) =>
  ({ id: 'battery', label: 'Battery', text, percent }) satisfies DeviceInfoRow;

/** The fill of the battery bar, which is drawn only for a reading. */
const fillOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-row="battery"] [style]');

describe('DeviceCard', () => {
  describe('rows', () => {
    it('lists each row as a term and its definition, in the order given', () => {
      render(<DeviceCard rows={[...BASE, LOCATION, status('running', 'Running')]} />);

      expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
        'Device name',
        'Device ID',
        'Class',
        'Location',
        'Status',
      ]);
      expect(screen.getAllByRole('definition').map((def) => def.textContent)).toEqual([
        'Smoke detector',
        'SD-0043',
        'Smoke detector',
        'Science Lab · level 2',
        'Running',
      ]);
    });

    it('draws only the rows it is given', () => {
      render(<DeviceCard rows={BASE} />);

      expect(screen.getAllByRole('term')).toHaveLength(3);
      expect(screen.queryByText('Location')).not.toBeInTheDocument();
      expect(screen.queryByText('Status')).not.toBeInTheDocument();
      expect(screen.queryByText('Battery')).not.toBeInTheDocument();
    });

    it('is a region named by its heading', () => {
      render(<DeviceCard rows={BASE} />);

      expect(screen.getByRole('region', { name: 'Device information' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Device information' })).toBeInTheDocument();
    });
  });

  // The rows come from `deviceInfoRows`: the card shows what it returns and no more (AC 3).
  describe('with the rows of a device', () => {
    const point = (overrides: Partial<TelemetryPoint>): TelemetryPoint => ({
      key: 'smokePpm',
      label: 'Smoke',
      unit: 'ppm',
      kind: 'number',
      min: 0,
      max: 100,
      enumValues: null,
      expectedIntervalS: 5,
      headline: 1,
      ...overrides,
    });
    const BATTERY_POINT = point({
      key: 'batteryPct',
      label: 'Battery',
      unit: '%',
      headline: null,
      expectedIntervalS: 3600,
    });
    const detail = (
      points: TelemetryPoint[],
    ): Pick<AssetDetail, 'name' | 'code' | 'class' | 'points' | 'elevationM'> => ({
      name: 'Smoke detector',
      code: 'SD-0043',
      class: {
        id: 'class-smoke',
        code: 'smoke_detector',
        name: 'Smoke detector',
        modelUrl: null,
        footprintM: { width: 1, depth: 1, height: 1 },
      },
      points,
      elevationM: 0,
    });
    const lab: Pick<Zone, 'name' | 'kind' | 'heightM'> = {
      name: 'Science Lab',
      kind: 'building',
      heightM: 10,
    };

    it('has no battery row for a class without the point', () => {
      const rows = deviceInfoRows(detail([point({})]), lab, 'running', {
        values: { batteryPct: 92 },
      });
      render(<DeviceCard rows={rows} />);

      expect(screen.queryByText('Battery')).not.toBeInTheDocument();
      expect(screen.queryByText('92 %')).not.toBeInTheDocument();
    });

    it('has a battery row for a class with the point', () => {
      const rows = deviceInfoRows(detail([point({}), BATTERY_POINT]), lab, 'running', {
        values: { batteryPct: 92 },
      });
      render(<DeviceCard rows={rows} />);

      expect(screen.getByText('Battery')).toBeInTheDocument();
      expect(screen.getByText('92 %')).toBeInTheDocument();
    });
  });

  describe('status', () => {
    it.each([
      ['running', 'Running'],
      ['standby', 'Standby'],
      ['nodata', 'No data'],
      ['offline', 'Offline'],
    ] as const)('says %s as a glyph and the word', (state, word) => {
      render(<DeviceCard rows={[...BASE, status(state, word)]} />);

      const pill = screen.getByText(word);
      expect(pill).toHaveAttribute('data-state', state);
      expect(pill).not.toHaveAttribute('data-severity');
      expect(pill.querySelector('svg')).not.toBeNull();
    });

    it('says a fault with its incident severity, in words and in the glyph', () => {
      render(<DeviceCard rows={[...BASE, status('fault', 'Fault')]} severity="high" />);

      const pill = screen.getByText('Fault');
      expect(pill).toHaveAttribute('data-state', 'fault');
      expect(pill).toHaveAttribute('data-severity', 'high');
      expect(pill).toHaveTextContent('High severity, Fault');
      expect(pill.querySelector('svg')).not.toBeNull();
    });

    it('says a fault with no severity as its word alone', () => {
      render(<DeviceCard rows={[...BASE, status('fault', 'Fault')]} />);

      const pill = screen.getByText('Fault');
      expect(pill).toHaveTextContent(/^Fault$/);
      expect(pill).not.toHaveAttribute('data-severity');
      expect(pill.querySelector('svg')).toBeNull();
    });

    it('does not tint a state that is not a fault, whatever severity it is given', () => {
      render(<DeviceCard rows={[...BASE, status('running', 'Running')]} severity="critical" />);

      const pill = screen.getByText('Running');
      expect(pill).not.toHaveAttribute('data-severity');
      expect(pill).toHaveTextContent(/^Running$/);
    });

    it('draws no glyph for a state that has none, and does not throw', () => {
      render(<DeviceCard rows={[...BASE, status('unknown', 'Unknown')]} />);

      expect(screen.getByText('Unknown').querySelector('svg')).toBeNull();
    });
  });

  describe('battery', () => {
    it('writes the figure and draws a bar to that share', () => {
      const { container } = render(<DeviceCard rows={[...BASE, battery(92, '92 %')]} />);

      expect(screen.getByText('92 %')).toBeInTheDocument();
      expect(fillOf(container)).toHaveStyle({ width: '92%' });
    });

    it('hides the bar from assistive technology: the figure is the reading', () => {
      const { container } = render(<DeviceCard rows={[...BASE, battery(92, '92 %')]} />);

      expect(container.querySelector('[data-row="battery"] [aria-hidden="true"]')).not.toBeNull();
      expect(screen.getByText('92 %').closest('[aria-hidden="true"]')).toBeNull();
    });

    it('reads "—" and draws no fill while there is no reading', () => {
      const { container } = render(<DeviceCard rows={[...BASE, battery(null, '—')]} />);

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(fillOf(container)).toBeNull();
    });

    it('keeps a reading outside 0 to 100 inside the bar and writes it as it came', () => {
      const { container, rerender } = render(
        <DeviceCard rows={[...BASE, battery(118, '118 %')]} />,
      );
      expect(screen.getByText('118 %')).toBeInTheDocument();
      expect(fillOf(container)).toHaveStyle({ width: '100%' });

      rerender(<DeviceCard rows={[...BASE, battery(-4, '-4 %')]} />);
      expect(screen.getByText('-4 %')).toBeInTheDocument();
      expect(fillOf(container)).toHaveStyle({ width: '0%' });
    });
  });

  describe('collapsing', () => {
    it('starts open, with a header button that says so', () => {
      render(<DeviceCard rows={BASE} />);

      const header = screen.getByRole('button', { name: 'Device information' });
      expect(header).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByRole('term')).toHaveLength(3);
    });

    it('names the rows it controls', () => {
      render(<DeviceCard rows={BASE} />);

      const controlled = screen
        .getByRole('button', { name: 'Device information' })
        .getAttribute('aria-controls');
      expect(controlled).toBeTruthy();
      expect(document.getElementById(controlled as string)).toHaveTextContent('SD-0043');
    });

    it('hides the rows when the header is pressed, and shows them when it is pressed again', async () => {
      render(<DeviceCard rows={BASE} />);
      const header = screen.getByRole('button', { name: 'Device information' });

      await userEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryAllByRole('term')).toHaveLength(0);
      expect(screen.getByText('SD-0043')).not.toBeVisible();

      await userEvent.click(header);
      expect(header).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByRole('term')).toHaveLength(3);
    });

    it('is operated from the keyboard: Tab to it, Enter and Space toggle it', async () => {
      render(<DeviceCard rows={BASE} />);
      const header = screen.getByRole('button', { name: 'Device information' });

      await userEvent.tab();
      expect(header).toHaveFocus();

      await userEvent.keyboard('{Enter}');
      expect(header).toHaveAttribute('aria-expanded', 'false');

      await userEvent.keyboard(' ');
      expect(header).toHaveAttribute('aria-expanded', 'true');
    });

    it('keeps its state while its rows change', async () => {
      const { rerender } = render(<DeviceCard rows={BASE} />);
      await userEvent.click(screen.getByRole('button', { name: 'Device information' }));

      rerender(<DeviceCard rows={[...BASE, status('running', 'Running')]} />);

      expect(screen.getByRole('button', { name: 'Device information' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
  });

  describe('accessibility', () => {
    it('has no axe violations, open', async () => {
      const { container } = render(
        <DeviceCard
          rows={[...BASE, LOCATION, status('fault', 'Fault'), battery(92, '92 %')]}
          severity="critical"
        />,
      );

      await expectNoAxeViolations(container);
    });

    it('has no axe violations, collapsed', async () => {
      const { container } = render(
        <DeviceCard rows={[...BASE, LOCATION, status('running', 'Running'), battery(null, '—')]} />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Device information' }));

      await expectNoAxeViolations(container);
    });
  });
});
