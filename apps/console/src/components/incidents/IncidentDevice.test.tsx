import type {
  AssetDetail,
  Incident,
  IncidentDetail,
  TelemetryPoint,
  TelemetryRule,
  Zone,
} from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import { queryKeys } from '../../api/queries';
import { getAccessToken, renewSession } from '../../auth/session';
import { useSession } from '../../auth/store';
import {
  type AssetTelemetryState,
  initialTelemetryState,
} from '../../lib/telemetry/telemetryState';
import { useTelemetryStore } from '../../realtime/telemetryStore';
import { useConsole } from '../../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../../test-utils';
import { IncidentDevice } from './IncidentDevice';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const RECEIVED = '2026-10-16T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: 0,
  max: 3000,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
  ...overrides,
});

const rule = (overrides: Partial<TelemetryRule> = {}): TelemetryRule => ({
  name: 'Motor over-temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'critical',
  incidentType: 'equipment_fault',
  ...overrides,
});

const FAN = point();
const TEMP = point({
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  min: -40,
  max: 150,
  headline: null,
});
const LEAK = point({
  key: 'leakDetected',
  label: 'Leak',
  unit: null,
  kind: 'boolean',
  min: null,
  max: null,
  headline: 1,
});
const BATTERY = point({
  key: 'batteryPct',
  label: 'Battery',
  unit: '%',
  min: 0,
  max: 100,
  expectedIntervalS: 3600,
  headline: null,
});

const ZONE: Zone = {
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
  polygon: [],
  center: [108.44, 11.95],
};

const asset = (overrides: Partial<AssetDetail> = {}): AssetDetail => ({
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
  zoneId: ZONE.id,
  position: ZONE.center,
  elevationM: 14,
  headingDeg: 0,
  headline: [FAN],
  points: [FAN, TEMP],
  rules: [rule()],
  ...overrides,
});

const TOWER = asset();
const LEAK_SENSOR = asset({
  id: 'asset-lks-b3',
  code: 'LKS-B3',
  name: 'Leak sensor, level 3',
  class: {
    id: 'class-leak',
    code: 'leak_sensor',
    name: 'Leak sensor',
    modelUrl: null,
    footprintM: { width: 1.4, depth: 1.4, height: 1.4 },
  },
  elevationM: 8,
  headline: [LEAK],
  points: [LEAK, BATTERY],
  rules: [rule({ name: 'Water leak', key: 'leakDetected', limit: 0.5, clear: 0.5, forS: 10 })],
});

function incident(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: 'incident-1',
    code: 'INC-000107',
    type: 'equipment_fault',
    severity: 'critical',
    status: 'open',
    title: 'Motor over-temperature — Cooling tower 1',
    description: null,
    zoneId: ZONE.id,
    position: ZONE.center,
    source: 'telemetry',
    assetId: TOWER.id,
    reportedAt: RECEIVED,
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    timeline: [],
    ...overrides,
  };
}

const entry = (values: AssetTelemetryState['values']): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: values,
  values,
  keyReceivedAt: {},
});

/** The API's clock `afterMs` after the reading was received. */
function hold(assets: Record<string, AssetTelemetryState>, afterMs = 400) {
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: RECEIVED_MS + afterMs, mono: performance.now() },
          assets,
        },
        series: new Map(),
      },
    }),
  );
}

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/**
 * The catalogue, the asset's detail, the zones and the incident list are cached, so the first render is
 * the loaded block. `catalogue: null` and `details: []` leave them to the (pending) fetch.
 */
function renderDevice(
  raised: IncidentDetail,
  {
    catalogue = [TOWER, LEAK_SENSOR],
    details = [TOWER, LEAK_SENSOR],
    incidents = [],
  }: {
    catalogue?: AssetDetail[] | null;
    details?: AssetDetail[];
    incidents?: Incident[];
  } = {},
) {
  const client = createTestQueryClient();
  if (catalogue) client.setQueryData(queryKeys.assets, catalogue);
  client.setQueryData(queryKeys.zones, [ZONE]);
  client.setQueryData(queryKeys.incidents, incidents);
  for (const cached of details) client.setQueryData(queryKeys.asset(cached.code), cached);
  return renderWithQueryClient(<IncidentDevice incident={raised} />, client);
}

/** The tile that carries a label. */
const tileOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('IncidentDevice', () => {
  beforeEach(() => {
    resetStore(useTelemetryStore);
    resetStore(useConsole);
    resetStore(useSession);
    fetchMock.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('an open incident', () => {
    beforeEach(() => hold({ 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92 }) }));

    it('draws the device card with the rows of the device', () => {
      renderDevice(incident());

      const card = screen.getByRole('region', { name: 'Device information' });
      expect(card).toHaveTextContent('Cooling tower 1');
      expect(card).toHaveTextContent('CT-01');
      expect(card).toHaveTextContent('Cooling tower');
      expect(screen.getByText('Location')).toBeInTheDocument();
    });

    it('draws a tile for each headline and ruled point, under the card', () => {
      renderDevice(incident());

      expect(screen.getByRole('heading', { name: 'Live data' })).toBeInTheDocument();
      expect(tileOf('Fan speed')).toHaveTextContent('1,420 rpm');
      expect(tileOf('Motor temperature')).toHaveTextContent('92 °C');
      const card = screen.getByRole('region', { name: 'Device information' });
      const tiles = screen.getByRole('region', { name: 'Live data' });
      expect(Boolean(card.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
        true,
      );
    });

    it('tints the tile of a reading past the rule, and says so in words', () => {
      renderDevice(incident());

      expect(tileOf('Motor temperature')).toHaveAttribute('data-severity', 'critical');
      expect(tileOf('Motor temperature')).toHaveTextContent('over its limit');
      expect(tileOf('Fan speed')).not.toHaveAttribute('data-severity');
    });

    it('says a fault with the severity of the incident open on the device', () => {
      renderDevice(incident());

      const pill = screen.getByText('Fault');
      expect(pill).toHaveAttribute('data-state', 'fault');
      expect(pill).toHaveAttribute('data-severity', 'critical');
      expect(pill).toHaveTextContent('Critical severity, Fault');
    });

    it('takes the severity of a more severe incident open on the same device', () => {
      const other: Incident = {
        ...incident({ id: 'incident-2', code: 'INC-000108', severity: 'critical' }),
      };
      renderDevice(incident({ severity: 'medium' }), { incidents: [other] });

      expect(screen.getByText('Fault')).toHaveAttribute('data-severity', 'critical');
    });

    it('treats an acknowledged incident as still open', () => {
      renderDevice(incident({ status: 'acknowledged', acknowledgedAt: RECEIVED }));

      expect(screen.getByRole('heading', { name: 'Live data' })).toBeInTheDocument();
    });

    it('has a battery row for a class with the point and none for one without', () => {
      hold({ 'LKS-B3': entry({ leakDetected: false, batteryPct: 92 }) });
      const { unmount } = renderDevice(incident({ assetId: LEAK_SENSOR.id }));
      expect(screen.getByText('Battery')).toBeInTheDocument();
      expect(screen.getByText('92 %')).toBeInTheDocument();
      unmount();

      renderDevice(incident());
      expect(screen.queryByText('Battery')).toBeNull();
    });
  });

  describe('a stale device', () => {
    it('dims the tiles and says the readings are the last ones', () => {
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420 }) }, 72_000);

      renderDevice(incident());

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(tileOf('Fan speed')).toHaveAttribute('data-stale', 'true');
      expect(screen.getByText('1 min 12 s old')).toBeInTheDocument();
    });
  });

  describe('a resolved incident', () => {
    beforeEach(() => hold({ 'CT-01': entry({ fanSpeedRpm: 1420 }) }));

    it('keeps the card and draws no live tiles', () => {
      renderDevice(incident({ status: 'resolved', resolvedAt: RECEIVED }));

      expect(screen.getByRole('region', { name: 'Device information' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Live data' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Last readings' })).toBeNull();
      expect(screen.queryByText('Fan speed')).toBeNull();
    });
  });

  describe('loading', () => {
    it('shows a skeleton and says so while the catalogue loads', () => {
      renderDevice(incident(), { catalogue: null, details: [] });

      expect(screen.getByRole('status')).toHaveTextContent('Loading device…');
      expect(screen.queryByRole('region', { name: 'Device information' })).toBeNull();
    });

    it('shows a skeleton while the asset loads', () => {
      renderDevice(incident(), { details: [] });

      expect(screen.getByRole('status')).toHaveTextContent('Loading device…');
    });
  });

  // Nothing is drawn: the evidence says "Rule details could not be loaded", and no placeholder repeats it.
  describe('a device it cannot show', () => {
    it('draws nothing when the catalogue has no such asset', () => {
      const { container } = renderDevice(incident(), { catalogue: [], details: [] });

      expect(container).toBeEmptyDOMElement();
    });

    it.each([
      ['answers 404', 404],
      ['fails', 500],
    ])('draws nothing when the asset %s', async (_name, status) => {
      fetchMock.mockResolvedValue(json({ statusCode: status, message: 'No' }, status));

      const { container } = renderDevice(incident(), { details: [] });

      await waitFor(() => expect(screen.queryByText('Loading device…')).toBeNull());
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations with the card and the tiles', async () => {
      hold({ 'CT-01': entry({ fanSpeedRpm: 1420, motorTempC: 92 }) });
      const { container } = renderDevice(incident());

      await expectNoAxeViolations(container);
    });

    it('has no axe violations while loading', async () => {
      const { container } = renderDevice(incident(), { details: [] });

      await expectNoAxeViolations(container);
    });
  });
});
