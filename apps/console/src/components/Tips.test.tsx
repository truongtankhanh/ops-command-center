import type { Asset, Camera, Incident, TelemetryPoint } from '@occ/contracts';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { formatReading } from '../lib/readings';
import { type AssetTelemetryState, initialTelemetryState } from '../lib/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { resetStore } from '../test-utils';
import { AssetTip, CameraTip, ClusterTip, IncidentTip } from './Tips';
import { tipSurface } from './tipSurface';

/*
 * The bodies of the hover tooltips, rendered on their own (V2-15.5). The cases for the asset body are the ones
 * `MapTooltip.test.tsx` has through the map: that file stays as it is, so the 2D tooltip is held by its own
 * tests and these hold the bodies the 3D tooltip shares.
 */

const POSITION: [number, number] = [108.44, 11.95];

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'a',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'high',
  status: 'open',
  title: 'Door forced open',
  description: null,
  zoneId: 'z1',
  position: POSITION,
  source: 'operator',
  reportedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const camera = (overrides: Partial<Camera> = {}): Camera => ({
  id: 'c1',
  code: 'CAM-D02',
  name: 'Data center loading bay',
  zoneId: 'z1',
  position: POSITION,
  online: true,
  fieldOfView: null,
  ...overrides,
});

const point = (key: string, label: string, unit: string): TelemetryPoint => ({
  key,
  label,
  unit,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
});

const FAN = point('fanSpeedRpm', 'Fan speed', 'rpm');
const MOTOR = point('motorTempC', 'Motor temperature', '°C');

/** A cooling tower in the library: its state point is `running`, which the telemetry carries. */
const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: POSITION,
  elevationM: 0,
  headingDeg: 0,
  headline: [FAN, MOTOR],
  ...overrides,
});

/**
 * What the console holds of an asset, with the API's clock anchored now, so `ageSeconds` is how old
 * the latest reading reads. Set before the body renders: `useServerNow` reads the clock once.
 */
function holdTelemetry(
  entries: Record<string, Partial<AssetTelemetryState> & { ageSeconds?: number }>,
) {
  const at = Date.now();
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at, mono: performance.now() },
          assets: Object.fromEntries(
            Object.entries(entries).map(([code, { ageSeconds = 3, ...rest }]) => [
              code,
              {
                online: true,
                receivedAt: new Date(at - ageSeconds * 1000).toISOString(),
                headline: {},
                values: { fanSpeedRpm: 1420, motorTempC: 62.5, running: true },
                keyReceivedAt: {},
                ...rest,
              } satisfies AssetTelemetryState,
            ]),
          ),
        },
        series: new Map(),
      },
    }),
  );
}

/** A body on the surface a tooltip puts it on; the tooltip is `aria-hidden` in use, so it is found by id. */
function renderTip(body: ReactNode) {
  render(
    <div data-testid="tip" className={tipSurface}>
      {body}
    </div>,
  );
  return screen.getByTestId('tip');
}

describe('Tips', () => {
  beforeEach(() => {
    resetStore(useTelemetryStore);
  });

  describe('IncidentTip', () => {
    it('describes the incident', () => {
      const tip = renderTip(<IncidentTip incident={incident()} zone="Library" />);

      expect(screen.getByText('Door forced open')).toBeInTheDocument();
      expect(screen.getByText('INC-000001 · Library · 5m')).toBeInTheDocument();
      // Severity and status share one line, so they are read from the tooltip as a whole.
      expect(tip).toHaveTextContent('High');
      expect(tip).toHaveTextContent('Open');
    });

    it('describes an incident whose type this console does not know', () => {
      // A newer API can send a type this build's contract lacks (ADR-0021, rolling deploys).
      renderTip(
        <IncidentTip
          incident={incident({ type: 'not_in_contract' as Incident['type'] })}
          zone="Library"
        />,
      );

      expect(screen.getByText('Door forced open')).toBeInTheDocument();
    });

    it('leaves the zone out when it is unknown', () => {
      renderTip(<IncidentTip incident={incident()} />);

      expect(screen.getByText('INC-000001 · 5m')).toBeInTheDocument();
    });
  });

  describe('CameraTip', () => {
    it('names an offline camera', () => {
      renderTip(<CameraTip camera={camera({ online: false })} zone="Library" />);

      expect(screen.getByText('Data center loading bay')).toBeInTheDocument();
      expect(screen.getByText('CAM-D02 · Library · Offline')).toBeInTheDocument();
    });

    it("says nothing about an online camera's state", () => {
      renderTip(<CameraTip camera={camera()} zone="Library" />);

      expect(screen.getByText('CAM-D02 · Library')).toBeInTheDocument();
      expect(screen.queryByText(/Offline/)).toBeNull();
    });
  });

  describe('ClusterTip', () => {
    it('summarises a cluster', () => {
      renderTip(<ClusterTip count={4} severity="critical" />);

      expect(screen.getByText('4 incidents')).toBeInTheDocument();
      expect(screen.getByText('Highest: Critical')).toBeInTheDocument();
      expect(screen.getByText('Click to zoom in')).toBeInTheDocument();
    });
  });

  describe('AssetTip', () => {
    it('names the asset and its code, and says where a click leads', () => {
      holdTelemetry({ 'CT-01': {} });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('Cooling tower 1');
      expect(tip).toHaveTextContent('CT-01');
      expect(tip).toHaveTextContent('Click to inspect · Library');
    });

    it('says the state in the list’s words', () => {
      holdTelemetry({ 'CT-01': {} });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('Running');
    });

    it('shows the two headline readings from the overview, formatted as the list does', () => {
      holdTelemetry({ 'CT-01': {} });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('Fan speed');
      expect(tip).toHaveTextContent(formatReading(FAN, 1420));
      expect(tip).toHaveTextContent('Motor temperature');
      expect(tip).toHaveTextContent(formatReading(MOTOR, 62.5));
    });

    it('draws a dash for a reading it has no value for', () => {
      holdTelemetry({ 'CT-01': { values: { fanSpeedRpm: 1420 } } });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('Motor temperature—');
    });

    // One age for the asset, not one per reading (V2-08.3): a steady reading would read "old".
    it('says how old the latest reading is, once, while it is live', () => {
      holdTelemetry({ 'CT-01': { ageSeconds: 3 } });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip.textContent?.match(/Updated 3 s ago/g)).toHaveLength(1);
    });

    it('says no data with its age, and dims the last values, when the reading is old', () => {
      holdTelemetry({ 'CT-01': { ageSeconds: 90 } });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('No data · 1 min');
      expect(tip).toHaveTextContent('1 min 30 s old');
      expect(tip.querySelector('dd')).toHaveAttribute('data-stale', 'true');
    });

    it('says offline when the device’s last will fired', () => {
      holdTelemetry({ 'CT-01': { online: false, ageSeconds: 30 } });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('Offline · 30 s');
    });

    it('says a fault with the incident code, even when the reading is old', () => {
      holdTelemetry({ 'CT-01': { ageSeconds: 600 } });
      const tip = renderTip(
        <AssetTip
          asset={asset()}
          incidents={[incident({ id: 'inc', code: 'INC-000108', assetId: 'asset-ct-01' })]}
          zone="Library"
        />,
      );

      expect(tip).toHaveTextContent('Fault · INC-000108');
    });

    it('says only what it knows for an asset nothing was received about', () => {
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} zone="Library" />);

      expect(tip).toHaveTextContent('No data');
      expect(tip).not.toHaveTextContent('Updated');
      expect(tip).toHaveTextContent('Fan speed—');
    });

    it('leaves the zone out of the foot when the zone is unknown', () => {
      holdTelemetry({ 'CT-01': {} });
      const tip = renderTip(<AssetTip asset={asset()} incidents={[]} />);

      expect(tip).toHaveTextContent(/Click to inspect$/);
    });

    // V2-15.5: the 3D view's foot is the place line, or says the asset is a box (V2-15.1, frame 15).
    it('ends with the foot it is given instead of the default one', () => {
      holdTelemetry({ 'CT-01': {} });
      const tip = renderTip(
        <AssetTip
          asset={asset()}
          incidents={[]}
          zone="Library"
          foot="Click to inspect · Library · roof"
        />,
      );

      expect(tip).toHaveTextContent('Click to inspect · Library · roof');
      expect(tip).not.toHaveTextContent('Click to inspect · Library Click');
    });

    it('says an asset is drawn as a box when its foot says so', () => {
      const tip = renderTip(
        <AssetTip
          asset={asset()}
          incidents={[]}
          zone="Library"
          foot="No 3D model · drawn as a box"
        />,
      );

      expect(tip).toHaveTextContent('No 3D model · drawn as a box');
      expect(tip).not.toHaveTextContent('Click to inspect');
    });
  });
});
