import type {
  AssetDetail,
  Incident,
  LngLat,
  Role,
  TelemetryPoint,
  TelemetryRule,
  Zone,
} from '@occ/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { TOO_MANY_REQUESTS } from '../api/client';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useSession } from '../auth/store';
import { type AssetTelemetryState, initialTelemetryState } from '../lib/telemetryState';
import type { NodeInfo } from '../lib/twinBindings';
import type * as TwinFocus from '../lib/twinFocus';
import { focusSelection } from '../lib/twinFocus';
import { seriesKey, type SeriesView } from '../realtime/telemetryClient';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { AssetInspector } from './AssetInspector';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

// "Focus" asks the canvas to fly; there is none here, so only the request is observed. The rule that shows the
// button (`focusAvailable`) stays real.
vi.mock('../lib/twinFocus', async (importOriginal) => ({
  ...(await importOriginal<typeof TwinFocus>()),
  focusSelection: vi.fn(),
}));

const RECEIVED = '2026-10-15T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: null,
  ...overrides,
});

const FAN = point({ headline: 1 });
const TEMP = point({
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  min: -40,
  max: 150,
  headline: 2,
});
const VIBRATION = point({ key: 'vibrationMms', label: 'Vibration', unit: 'mm/s' });
const RUNNING = point({ key: 'running', label: 'Run state', unit: null, kind: 'boolean' });
const MODE = point({
  key: 'controlMode',
  label: 'Control mode',
  unit: null,
  kind: 'enum',
  enumValues: ['off', 'manual', 'auto'],
});
const SETPOINT = point({ key: 'fanSetpointRpm', label: 'Fan set point' });
const ODD = point({ key: 'oddity', label: 'Oddity', unit: null, kind: 'quantum' as never });

const rule = (overrides: Partial<TelemetryRule>): TelemetryRule => ({
  name: 'Rule',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 5,
  severity: 'critical',
  incidentType: 'equipment_fault',
  ...overrides,
});

const zone: Zone = {
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
  polygon: [],
  center: [108.44, 11.95],
};

const TOWER_URL = '/models/cooling_tower.961e8f9f464e.glb';
const GENERATOR_URL = '/models/standby_generator.f37bf7611883.glb';

const part = (name: string, extras?: unknown, children?: NodeInfo[]): NodeInfo => ({
  name,
  ...(extras === undefined ? {} : { extras }),
  ...(children === undefined ? {} : { children }),
});

/** The node trees of the two stand-in models in `ops/models`, as `useModelParts` resolves them. */
const TOWER_TREE = part('CoolingTower', undefined, [
  part('Casing'),
  part('FanStack', undefined, [
    part('FanBlade', {
      bind: 'fanSpeedRpm',
      motion: 'spin',
      axis: 'y',
      range: [0, 1800],
      label: 'Fan blade',
    }),
  ]),
  part('FanMotor', { bind: 'motorTempC', motion: 'tint', label: 'Fan motor' }),
  part('Pump', { bind: 'pumpFlowM3h', motion: 'tint', label: 'Pump' }),
  part('Pipe'),
  part('Riser'),
  part('Valve', {
    bind: 'valveOpenPct',
    motion: 'turn',
    axis: 'x',
    range: [0, 90],
    label: 'Valve',
  }),
  part('ControlPanel', undefined, [
    part('Switch', {
      bind: 'switchState',
      motion: 'turn',
      axis: 'x',
      range: [-35, 35],
      label: 'Switch',
    }),
  ]),
]);

const GENERATOR_TREE = part('StandbyGenerator', undefined, [
  part('Enclosure'),
  part('FuelTank', { bind: 'fuelLevelPct', motion: 'tint', label: 'Fuel tank' }),
  part('Battery', { bind: 'starterBatteryV', motion: 'tint', label: 'Starter battery' }),
  part('Engine', { bind: 'coolantTempC', motion: 'tint', label: 'Engine' }),
  part('Alternator', { bind: 'alternatorKw', motion: 'tint', label: 'Alternator' }),
  part('Radiator', undefined, [
    part('RadiatorFan', {
      bind: 'engineSpeedRpm',
      motion: 'spin',
      axis: 'y',
      range: [0, 1800],
      label: 'Radiator',
    }),
  ]),
  part('ControlPanel', { bind: 'controlMode', motion: 'tint', label: 'Control panel' }, [
    part('Breaker', {
      bind: 'breakerClosed',
      motion: 'turn',
      axis: 'x',
      range: [0, 35],
      label: 'Breaker',
    }),
  ]),
  part('Silencer'),
  part('ExhaustStack'),
]);

const MODELS: Record<string, NodeInfo> = {
  [TOWER_URL]: TOWER_TREE,
  [GENERATOR_URL]: GENERATOR_TREE,
};

/** Headline: fan speed and motor temperature. Ruled: vibration. The rest is behind "All points". */
const DETAIL: AssetDetail = {
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: TOWER_URL,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: zone.id,
  position: [108.44, 11.95],
  elevationM: 14,
  headingDeg: 0,
  headline: [FAN, TEMP],
  points: [FAN, TEMP, VIBRATION, RUNNING, MODE, SETPOINT, ODD],
  rules: [
    rule({ key: 'motorTempC', name: 'Motor over temperature', limit: 85, severity: 'critical' }),
    rule({ key: 'vibrationMms', name: 'Vibration', limit: 7.1, severity: 'high' }),
  ],
};

const INCIDENT: Incident = {
  id: 'inc-1',
  code: 'INC-000108',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Motor over temperature',
  description: null,
  zoneId: zone.id,
  position: [0, 0],
  source: 'telemetry',
  assetId: DETAIL.id,
  reportedAt: RECEIVED,
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

const FUEL = point({ key: 'fuelLevelPct', label: 'Fuel level', unit: '%', headline: 1 });
const COOLANT = point({ key: 'coolantTempC', label: 'Coolant temperature', unit: '°C' });
const BREAKER = point({ key: 'breakerClosed', label: 'Main breaker', unit: null, kind: 'boolean' });
const ENGINE_SPEED = point({ key: 'engineSpeedRpm', label: 'Engine speed', unit: 'rpm' });

/** The other modelled class: its parts include a parent with a boolean and an enum underneath. */
const GENERATOR: AssetDetail = {
  ...DETAIL,
  id: 'asset-gen-01',
  code: 'GEN-01',
  name: 'Standby generator',
  class: {
    id: 'class-generator',
    code: 'standby_generator',
    name: 'Standby generator',
    modelUrl: GENERATOR_URL,
    footprintM: { width: 6, depth: 2.5, height: 3 },
  },
  headline: [FUEL],
  points: [FUEL, COOLANT, BREAKER, MODE, ENGINE_SPEED],
  rules: [],
};

const generatorEntry = (): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: { fuelLevelPct: 86 },
  values: { fuelLevelPct: 86, coolantTempC: 41, breakerClosed: false, controlMode: 'auto' },
  keyReceivedAt: {},
});

const LEAK = point({
  key: 'leakDetected',
  label: 'Leak',
  unit: null,
  kind: 'boolean',
  headline: 1,
});

/** A class with no model (frame 15). */
const SENSOR: AssetDetail = {
  ...DETAIL,
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
  headline: [LEAK],
  points: [LEAK],
  rules: [],
};

const sensorEntry = (): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: { leakDetected: true },
  values: { leakDetected: true },
  keyReceivedAt: {},
});

const entry = (values: AssetTelemetryState['values'] = {}): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: { fanSpeedRpm: 1420, motorTempC: 71 },
  values: {
    fanSpeedRpm: 1420,
    motorTempC: 71,
    vibrationMms: 2.8,
    running: true,
    controlMode: 'auto',
    fanSetpointRpm: 1450,
    oddity: 'strange',
    ...values,
  },
  keyReceivedAt: {},
});

/** The API's clock `afterMs` after the reading was received; the age of the reading, to the ms. */
const clockAfter = (afterMs: number) => ({ at: RECEIVED_MS + afterMs, mono: performance.now() });

/** A ring of the fan's last minutes, on the API's clock. */
const fanSeries = (afterMs: number): SeriesView => ({
  t: Float64Array.of(RECEIVED_MS + afterMs - 120_000, RECEIVED_MS + afterMs - 60_000),
  v: Float32Array.of(1400, 1420),
});

function hold({
  assets,
  afterMs,
  series = new Map<string, SeriesView>(),
}: {
  assets: Record<string, AssetTelemetryState>;
  afterMs: number;
  series?: Map<string, SeriesView>;
}) {
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: { ...initialTelemetryState, serverClock: clockAfter(afterMs), assets },
        series,
      },
    }),
  );
}

const fetchMock = vi.fn<typeof fetch>();
/** What the next requests answer, one factory per request; once empty, a request stays pending. */
let answers: (() => Response)[];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });
const apiError = (status: number, message: string): Response =>
  json({ statusCode: status, message }, status);

/** Everything the sheet reads is cached, so its first render is the loaded asset. */
function renderInspector({
  detail = DETAIL,
  incidents,
  zones = [zone],
  model,
}: {
  detail?: AssetDetail;
  incidents?: Incident[];
  zones?: Zone[];
  /** What the model's query holds: the class's stand-in tree by default, `null` for a file with no class root,
   * `false` for nothing (the file is on its way). */
  model?: NodeInfo | null | false;
} = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.asset(detail.code), detail);
  client.setQueryData(queryKeys.zones, zones);
  if (incidents) client.setQueryData(queryKeys.incidents, incidents);
  const url = detail.class.modelUrl;
  const tree = model === undefined ? (url === null ? undefined : MODELS[url]) : model;
  if (url !== null && tree !== undefined && tree !== false) {
    client.setQueryData(queryKeys.model(url), tree);
  }
  return renderWithQueryClient(<AssetInspector code={detail.code} />, client);
}

/** The asset itself is not cached: the sheet starts loading it. */
function renderUncached() {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, [zone]);
  client.setQueryData(queryKeys.incidents, []);
  client.setQueryData(queryKeys.model(TOWER_URL), TOWER_TREE);
  return renderWithQueryClient(<AssetInspector code="CT-01" />, client);
}

const readingRow = (label: string): HTMLElement => {
  const row = screen.getByText(label).closest('li');
  if (!row) throw new Error(`no reading row for ${label}`);
  return row;
};

const partRow = (label: string): HTMLElement => {
  const row = within(screen.getByRole('tree')).getByText(label).closest('[role="treeitem"]');
  if (!row) throw new Error(`no part row for ${label}`);
  return row as HTMLElement;
};

describe('AssetInspector', () => {
  beforeEach(() => {
    resetStore(useConsole);
    resetStore(useTelemetryStore);
    resetStore(useSession);
    answers = [];
    fetchMock.mockReset().mockImplementation(() => {
      const answer = answers.shift();
      return answer ? Promise.resolve(answer()) : new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    vi.mocked(focusSelection).mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  describe('live', () => {
    beforeEach(() => hold({ assets: { 'CT-01': entry() }, afterMs: 400 }));

    it('names the sheet and shows the head and the badges', () => {
      renderInspector({ incidents: [] });

      expect(screen.getByRole('complementary', { name: 'Asset CT-01' })).toBeInTheDocument();
      expect(screen.getByText('CT-01 · Cooling tower')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Cooling tower 1' }),
      ).toBeInTheDocument();
      // The pill: a state word (a boolean row below also reads "Running", so match on the state).
      expect(
        screen.getAllByText('Running').some((el) => el.getAttribute('data-state') === 'running'),
      ).toBe(true);
      expect(screen.getByText('Data Center · roof')).toBeInTheDocument();
      expect(screen.getByText('No open incidents')).toBeInTheDocument();
    });

    it('shows the headline and ruled points with their value, unit and rule line', () => {
      renderInspector({ incidents: [] });

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(within(readingRow('Fan speed')).getByText('1,420 rpm')).toBeInTheDocument();
      expect(within(readingRow('Motor temperature')).getByText('71 °C')).toBeInTheDocument();
      expect(within(readingRow('Motor temperature')).getByText('Limit 85 °C')).toBeInTheDocument();
      expect(within(readingRow('Vibration')).getByText('2.8 mm/s')).toBeInTheDocument();
      expect(within(readingRow('Vibration')).getByText('Limit 7.1 mm/s')).toBeInTheDocument();
    });

    it('says how long ago, outside any live region', () => {
      renderInspector({ incidents: [] });

      const text = screen.getByText(/^Updated \d(\.\d)? s ago$/);
      expect(text.closest('[role="status"], [aria-live]')).toBeNull();
    });

    it('draws a decorative sparkline per number row, with the limit line where there is a rule', () => {
      hold({
        assets: { 'CT-01': entry() },
        afterMs: 400,
        series: new Map([[seriesKey('CT-01', 'fanSpeedRpm'), fanSeries(400)]]),
      });
      renderInspector({ incidents: [] });

      const fan = readingRow('Fan speed').querySelector('svg');
      expect(fan).toHaveAttribute('aria-hidden', 'true');
      // The ring's two points and the latest value at "now": a line, and a dot at the right edge.
      expect(fan?.querySelector('polyline')).toBeInTheDocument();
      expect(fan?.querySelector('circle')).toHaveAttribute('cx', '96');
      expect(fan).not.toHaveAttribute('data-stale');
      expect(readingRow('Fan speed').querySelector('line')).toBeNull();
      expect(readingRow('Motor temperature').querySelector('svg line')).toBeInTheDocument();
    });

    it('tints a value past its rule with the rule severity, and says so in words', () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });
      renderInspector({ incidents: [] });

      const row = readingRow('Motor temperature');
      expect(row).toHaveAttribute('data-severity', 'critical');
      expect(row.querySelector('svg')).toHaveAttribute('data-severity', 'critical');
      expect(within(row).getByText(/over its limit/)).toBeInTheDocument();
      expect(readingRow('Fan speed')).not.toHaveAttribute('data-severity');
    });

    it('shows a fault with the incident code, and the pill takes the incident severity', () => {
      renderInspector({ incidents: [INCIDENT] });

      expect(screen.getByText('Fault · INC-000108')).toBeInTheDocument();
      // The pill says Fault, and its glyph is the incident's severity (a hidden word says which).
      expect(screen.getByText('Fault')).toHaveAttribute('data-state', 'fault');
      expect(screen.getByText('Fault')).toHaveAttribute('data-severity', 'high');
    });

    it('does not say "No open incidents" while the incident list is loading', () => {
      renderInspector();

      expect(screen.queryByText('No open incidents')).toBeNull();
    });
  });

  describe('all points', () => {
    beforeEach(() => hold({ assets: { 'CT-01': entry() }, afterMs: 400 }));

    it('keeps the other points behind a disclosure with their count', () => {
      renderInspector({ incidents: [] });

      expect(screen.getByText('All points (4)')).toBeInTheDocument();
      const more = screen.getByText('All points (4)').closest('details');
      expect(more).not.toHaveAttribute('open');
      expect(within(more as HTMLElement).getAllByRole('listitem', { hidden: true })).toHaveLength(
        4,
      );
    });

    it('words a boolean and an enum, and draws no limit line for a boolean', () => {
      renderInspector({ incidents: [] });

      expect(within(readingRow('Control mode')).getByText('Auto')).toBeInTheDocument();
      // An enum has no series: the value only.
      expect(readingRow('Control mode').querySelector('svg')).toBeNull();
      // A boolean steps and its 0.5 is an encoding, not a limit.
      expect(readingRow('Run state').querySelector('svg')).toBeInTheDocument();
      expect(readingRow('Run state').querySelector('line')).toBeNull();
    });

    it('does not throw for a point of a kind it does not know, and shows its value', () => {
      renderInspector({ incidents: [] });

      const odd = readingRow('Oddity');
      expect(within(odd).getByText('strange')).toBeInTheDocument();
      expect(odd.querySelector('svg')).toBeNull();
    });
  });

  describe('a point with no reading', () => {
    it('shows a dash and no sparkline', () => {
      const without = entry();
      delete (without.values as Record<string, unknown>).motorTempC;
      delete (without.headline as Record<string, unknown>).motorTempC;
      hold({ assets: { 'CT-01': without }, afterMs: 400 });

      renderInspector({ incidents: [] });

      const row = readingRow('Motor temperature');
      expect(within(row).getByText('—')).toBeInTheDocument();
      expect(row.querySelector('svg')).toBeNull();
    });

    it('shows dashes and no age before anything was received for the asset', () => {
      hold({ assets: {}, afterMs: 400 });

      renderInspector({ incidents: [] });

      expect(within(readingRow('Fan speed')).getByText('—')).toBeInTheDocument();
      expect(screen.queryByText(/ago$|old$/)).toBeNull();
    });
  });

  describe('stale', () => {
    beforeEach(() =>
      hold({
        assets: { 'CT-01': entry() },
        afterMs: 72_000,
        series: new Map([[seriesKey('CT-01', 'fanSpeedRpm'), fanSeries(72_000)]]),
      }),
    );

    it('turns the eyebrow, the age and the hint to the last readings', () => {
      renderInspector({ incidents: [] });

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(screen.getByText('1 min 12 s old')).toBeInTheDocument();
      expect(
        screen.getByText('Charts stop at the last reading; the gap is the outage.'),
      ).toBeInTheDocument();
      expect(screen.getByText(/^No data since \d{2}:\d{2}$/)).toBeInTheDocument();
    });

    it('dims every row and stops the sparklines at the last reading', () => {
      renderInspector({ incidents: [] });

      const row = readingRow('Fan speed');
      expect(row).toHaveAttribute('data-stale', 'true');
      const sparkline = row.querySelector('svg');
      expect(sparkline).toHaveAttribute('data-stale');
      // Nothing is added at "now": the dot is the ring's last point, short of the right edge.
      expect(Number(sparkline?.querySelector('circle')?.getAttribute('cx'))).toBeLessThan(96);
    });

    it('is live again when a fresh reading arrives', () => {
      renderInspector({ incidents: [] });
      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();

      // The reading is received again, at the API's present.
      act(() =>
        useTelemetryStore.setState((state) => ({
          view: {
            ...state.view,
            state: {
              ...state.view.state,
              assets: {
                'CT-01': { ...entry(), receivedAt: new Date(RECEIVED_MS + 71_900).toISOString() },
              },
            },
          },
        })),
      );

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(screen.queryByText(/old$/)).toBeNull();
    });

    it('treats a device that went offline as stale at once', () => {
      hold({ assets: { 'CT-01': { ...entry(), online: false } }, afterMs: 400 });

      renderInspector({ incidents: [] });

      expect(screen.getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
      expect(screen.getByText(/^Offline since \d{2}:\d{2}$/)).toBeInTheDocument();
    });
  });

  describe('states of the sheet', () => {
    it('shows a placeholder, announced once, while the asset loads', () => {
      renderUncached();

      expect(screen.getByText('Loading asset…')).toHaveAttribute('role', 'status');
      // The code is known, so the sheet already has its name and Close.
      expect(screen.getByRole('complementary', { name: 'Asset CT-01' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close asset' })).toBeInTheDocument();
    });

    it('says a missing asset no longer exists', async () => {
      answers = [() => apiError(404, 'Asset CT-01 was not found')];

      renderUncached();

      expect(await screen.findByText('This asset no longer exists.')).toBeInTheDocument();
      // Retrying cannot bring it back.
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('retries a failed load', async () => {
      answers = [() => apiError(500, 'Internal server error'), () => json(DETAIL)];
      hold({ assets: { 'CT-01': entry() }, afterMs: 400 });
      renderUncached();
      expect(await screen.findByText('This asset could not be loaded.')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

      expect(
        await screen.findByRole('heading', { level: 2, name: 'Cooling tower 1' }),
      ).toBeInTheDocument();
    });

    it('explains too many requests', async () => {
      answers = [() => apiError(429, 'Too many requests')];

      renderUncached();

      expect(await screen.findByText(TOO_MANY_REQUESTS)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  describe('closing', () => {
    beforeEach(() => {
      hold({ assets: { 'CT-01': entry() }, afterMs: 400 });
      useConsole.getState().selectAsset('CT-01', null);
    });

    it('clears the asset with Close', async () => {
      renderInspector({ incidents: [] });

      await userEvent.click(screen.getByRole('button', { name: 'Close asset' }));

      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('clears the asset with Escape', () => {
      renderInspector({ incidents: [] });

      fireEvent.keyDown(screen.getByRole('complementary', { name: 'Asset CT-01' }), {
        key: 'Escape',
      });

      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    describe('with a part selected (V2-15.11)', () => {
      beforeEach(() => useConsole.getState().selectPart('FanBlade'));

      const pressEscape = () =>
        fireEvent.keyDown(screen.getByRole('complementary', { name: 'Asset CT-01' }), {
          key: 'Escape',
        });

      it('closes the callout first with Escape and keeps the asset and the sheet', () => {
        renderInspector({ incidents: [] });

        pressEscape();

        expect(useConsole.getState()).toMatchObject({
          selectedPart: null,
          selectedAssetCode: 'CT-01',
        });
        expect(screen.getByRole('complementary', { name: 'Asset CT-01' })).toBeInTheDocument();
      });

      it('closes the asset with the next Escape', () => {
        renderInspector({ incidents: [] });

        pressEscape();
        pressEscape();

        expect(useConsole.getState()).toMatchObject({
          selectedPart: null,
          selectedAssetCode: null,
        });
      });

      it('reads the part at the press: one selected in the scene after the render counts', () => {
        useConsole.getState().selectPart(null);
        renderInspector({ incidents: [] });
        act(() => useConsole.getState().selectPart('FanBlade'));

        pressEscape();

        expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      });

      it('closes the asset and the part together with Close', async () => {
        renderInspector({ incidents: [] });

        await userEvent.click(screen.getByRole('button', { name: 'Close asset' }));

        expect(useConsole.getState()).toMatchObject({
          selectedPart: null,
          selectedAssetCode: null,
        });
      });
    });
  });

  describe('parts', () => {
    beforeEach(() => hold({ assets: { 'CT-01': entry() }, afterMs: 400 }));

    it("lists the parts of the class's model in its order, with the static ones", () => {
      renderInspector({ incidents: [] });

      expect(screen.getByRole('heading', { level: 3, name: 'Parts' })).toBeInTheDocument();
      const items = within(screen.getByRole('tree', { name: 'Parts of CT-01' })).getAllByRole(
        'treeitem',
      );
      expect(items.map((item) => item.textContent)).toEqual([
        'Casingstatic',
        'Fan stackstatic',
        'Fan blade1,420 rpm',
        'Fan motor71 °C',
        'Pumpstatic',
        'Pipestatic',
        'Riserstatic',
        'Valvestatic',
        'Control panelstatic',
        'Switchstatic',
      ]);
    });

    it('puts a child one level under its parent and marks the parent open', () => {
      renderInspector({ incidents: [] });

      expect(partRow('Fan stack')).toHaveAttribute('aria-level', '1');
      expect(partRow('Fan stack')).toHaveAttribute('aria-expanded', 'true');
      expect(partRow('Fan blade')).toHaveAttribute('aria-level', '2');
      expect(partRow('Fan blade')).not.toHaveAttribute('aria-expanded');
      expect(partRow('Casing')).not.toHaveAttribute('aria-expanded');
    });

    it('reads a part bound to a point the asset does not have as a static one', () => {
      renderInspector({ incidents: [] });

      // `DETAIL` has no pump flow point, so the model's binding cannot be taken (`bindingsFromNodes`
      // drops it); the part is still the model's, and still listed.
      expect(partRow('Pump')).toHaveTextContent('static');
      expect(partRow('Pump')).not.toHaveAttribute('data-stale');
    });

    it('shows a dash for a bound part whose point has no reading yet', () => {
      const without = entry();
      delete (without.values as Record<string, unknown>).fanSpeedRpm;
      delete (without.headline as Record<string, unknown>).fanSpeedRpm;
      hold({ assets: { 'CT-01': without }, afterMs: 400 });

      renderInspector({ incidents: [] });

      expect(partRow('Fan blade')).toHaveTextContent('—');
    });

    it('reads a generator in the words of its points', () => {
      hold({ assets: { 'GEN-01': generatorEntry() }, afterMs: 400 });

      renderInspector({ detail: GENERATOR, incidents: [] });

      expect(partRow('Engine')).toHaveTextContent('41 °C');
      expect(partRow('Fuel tank')).toHaveTextContent('86 %');
      expect(partRow('Control panel')).toHaveTextContent('Auto');
      expect(partRow('Breaker')).toHaveTextContent('Open');
      expect(partRow('Breaker')).toHaveAttribute('aria-level', '2');
      expect(partRow('Enclosure')).toHaveTextContent('static');
    });

    it("lists the generator's model whole, a static radiator above the fan labelled the same", () => {
      hold({ assets: { 'GEN-01': generatorEntry() }, afterMs: 400 });

      renderInspector({ detail: GENERATOR, incidents: [] });

      const items = within(screen.getByRole('tree', { name: 'Parts of GEN-01' })).getAllByRole(
        'treeitem',
      );
      expect(items.map((item) => item.textContent)).toEqual([
        'Enclosurestatic',
        'Fuel tank86 %',
        'Batterystatic',
        'Engine41 °C',
        'Alternatorstatic',
        'Radiatorstatic',
        'Radiator—',
        'Control panelAuto',
        'BreakerOpen',
        'Silencerstatic',
        'Exhaust stackstatic',
      ]);
      expect(items.map((item) => item.getAttribute('aria-level'))).toEqual([
        '1',
        '1',
        '1',
        '1',
        '1',
        '1',
        '2',
        '1',
        '2',
        '1',
        '1',
      ]);
    });

    it('is read only in the 2D view: no button, no selection', () => {
      renderInspector({ incidents: [] });

      const tree = screen.getByRole('tree');
      expect(within(tree).queryByRole('button')).toBeNull();
      expect(within(tree).queryAllByRole('treeitem', { selected: true })).toHaveLength(0);
      expect(partRow('Fan blade')).not.toHaveAttribute('aria-selected');
    });

    describe('in the 3D view (V2-15.11)', () => {
      beforeEach(() => {
        useConsole.setState({ view: '3d' });
        useConsole.getState().selectAsset('CT-01', null);
      });

      it('selects a bound row and marks it, leaves a static row alone and has no button', () => {
        renderInspector({ incidents: [] });

        fireEvent.click(partRow('Casing'));
        expect(useConsole.getState().selectedPart).toBeNull();

        fireEvent.click(partRow('Fan blade'));

        expect(useConsole.getState().selectedPart).toBe('FanBlade');
        expect(partRow('Fan blade')).toHaveAttribute('aria-selected', 'true');
        expect(partRow('Fan motor')).toHaveAttribute('aria-selected', 'false');
        expect(partRow('Casing')).not.toHaveAttribute('aria-selected');
        expect(within(screen.getByRole('tree')).queryByRole('button')).toBeNull();
        expect(focusSelection).toHaveBeenCalledExactlyOnceWith('CT-01', 'FanBlade');
      });

      it('marks the row of the part clicked in the scene', () => {
        renderInspector({ incidents: [] });

        act(() => useConsole.getState().selectPart('FanBlade'));

        expect(partRow('Fan blade')).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('has one tab stop and moves it with the arrow keys, Home and End', () => {
      renderInspector({ incidents: [] });
      const items = within(screen.getByRole('tree')).getAllByRole('treeitem');
      const last = items.length - 1;
      expect(items.map((item) => item.getAttribute('tabindex'))).toEqual([
        '0',
        ...items.slice(1).map(() => '-1'),
      ]);

      fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
      expect(items[1]).toHaveFocus();
      expect(items[1]).toHaveAttribute('tabindex', '0');
      expect(items[0]).toHaveAttribute('tabindex', '-1');

      fireEvent.keyDown(items[1] as HTMLElement, { key: 'End' });
      expect(items[last]).toHaveFocus();
      // A list does not wrap.
      fireEvent.keyDown(items[last] as HTMLElement, { key: 'ArrowDown' });
      expect(items[last]).toHaveFocus();

      fireEvent.keyDown(items[last] as HTMLElement, { key: 'Home' });
      expect(items[0]).toHaveFocus();
      fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowUp' });
      expect(items[0]).toHaveFocus();
    });

    it('leaves the other keys to the browser', () => {
      renderInspector({ incidents: [] });
      const first = within(screen.getByRole('tree')).getAllByRole('treeitem')[0] as HTMLElement;

      // `fireEvent` returns `false` when the handler called `preventDefault`.
      expect(fireEvent.keyDown(first, { key: 'Tab' })).toBe(true);
    });

    it('says "last" before a reading that is not live, and not before a static part', () => {
      hold({ assets: { 'CT-01': entry() }, afterMs: 72_000 });

      renderInspector({ incidents: [] });

      expect(partRow('Fan blade')).toHaveTextContent('last 1,420 rpm');
      expect(partRow('Fan motor')).toHaveTextContent('last 71 °C');
      expect(partRow('Casing')).toHaveTextContent('static');
      expect(partRow('Casing')).not.toHaveTextContent('last');
      expect(partRow('Fan blade')).toHaveAttribute('data-stale', 'true');
      expect(partRow('Casing')).not.toHaveAttribute('data-stale');
    });

    it('shows a dash, not "last —", for a part with no reading while stale', () => {
      const without = entry();
      delete (without.values as Record<string, unknown>).fanSpeedRpm;
      delete (without.headline as Record<string, unknown>).fanSpeedRpm;
      hold({ assets: { 'CT-01': without }, afterMs: 72_000 });

      renderInspector({ incidents: [] });

      expect(partRow('Fan blade')).toHaveTextContent('—');
      expect(partRow('Fan blade')).not.toHaveTextContent('last');
    });

    it('has no Parts section for a class with no model, and no error', () => {
      hold({ assets: { 'LKS-B3': sensorEntry() }, afterMs: 400 });

      renderInspector({ detail: SENSOR, incidents: [] });

      expect(screen.queryByRole('tree')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Parts' })).toBeNull();
      expect(screen.queryByText('Loading parts…')).toBeNull();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Leak sensor, level 3' }),
      ).toBeInTheDocument();
      // A class with no model asks for no file.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('draws the Parts section as a skeleton while the model is read, the rest of the sheet in place', async () => {
      renderInspector({ incidents: [], model: false });

      expect(screen.getByRole('heading', { level: 3, name: 'Parts' })).toBeInTheDocument();
      expect(screen.getByText('Loading parts…')).toBeInTheDocument();
      expect(screen.queryByRole('tree')).toBeNull();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Cooling tower 1' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(TOWER_URL, { headers: { Range: 'bytes=0-65535' } }),
      );
    });

    it('draws no Parts section for a model with no class root, and does not say "No 3D model"', () => {
      renderInspector({ incidents: [], model: null });

      expect(screen.queryByRole('heading', { name: 'Parts' })).toBeNull();
      expect(screen.queryByText('Loading parts…')).toBeNull();
      expect(screen.queryByText('No 3D model')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
    });

    it('leaves the Parts section out when the model cannot be read, the sheet still working', async () => {
      answers = [() => apiError(404, 'Not found'), () => apiError(404, 'Not found')];

      renderInspector({ incidents: [], model: false });
      expect(screen.getByText('Loading parts…')).toBeInTheDocument();

      // `useModelParts` retries once, a second later.
      await waitFor(() => expect(screen.queryByText('Loading parts…')).toBeNull(), {
        timeout: 4000,
      });
      expect(screen.queryByRole('heading', { name: 'Parts' })).toBeNull();
      expect(screen.queryByText('No 3D model')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'In the twin' })).toBeNull();
      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
    });
  });

  describe('a class without a model', () => {
    beforeEach(() => hold({ assets: { 'LKS-B3': sensorEntry() }, afterMs: 400 }));

    it('says so in the head and in the twin, with the size from the class footprint', () => {
      renderInspector({ detail: SENSOR, incidents: [] });

      expect(screen.getByText('No 3D model')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'In the twin' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'This asset class has no model yet, so it is drawn as a 1.4 × 1.4 × 1.4 m neutral box ' +
            'at its position. Its readings, states and incident work exactly as for modelled assets.',
        ),
      ).toBeInTheDocument();
    });

    it('gives the three sides of a class that is not a cube', () => {
      const switchgear: AssetDetail = {
        ...SENSOR,
        class: { ...SENSOR.class, footprintM: { width: 6, depth: 1, height: 2.3 } },
      };

      renderInspector({ detail: switchgear, incidents: [] });

      expect(screen.getByText(/drawn as a 6 × 1 × 2\.3 m neutral box/)).toBeInTheDocument();
    });

    it('says nothing about a model for a class that has one', () => {
      hold({ assets: { 'CT-01': entry() }, afterMs: 400 });

      renderInspector({ incidents: [] });

      expect(screen.queryByText('No 3D model')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'In the twin' })).toBeNull();
    });

    it('does not claim "No 3D model" for a class that has a model with no named part', () => {
      const modelled: AssetDetail = {
        ...SENSOR,
        class: { ...SENSOR.class, modelUrl: '/models/leak_sensor.0123456789ab.glb' },
      };

      renderInspector({ detail: modelled, incidents: [], model: part('LeakSensor') });

      expect(screen.queryByText('No 3D model')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'In the twin' })).toBeNull();
      expect(screen.queryByRole('tree')).toBeNull();
    });
  });

  describe('the incident this asset raised', () => {
    beforeEach(() => hold({ assets: { 'CT-01': entry() }, afterMs: 400 }));

    const SECOND: Incident = {
      ...INCIDENT,
      id: 'inc-2',
      code: 'INC-000109',
      severity: 'critical',
      title: 'Vibration over limit',
    };

    it('shows it as the feed does, with a button that names it', () => {
      renderInspector({ incidents: [INCIDENT] });

      expect(
        screen.getByRole('heading', { level: 3, name: 'Incident raised by this asset' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Motor over temperature')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open INC-000108' })).toBeInTheDocument();
    });

    it('opens the incident, which closes the inspector', async () => {
      useConsole.getState().selectAsset('CT-01', null);
      renderInspector({ incidents: [INCIDENT] });

      await userEvent.click(screen.getByRole('button', { name: 'Open INC-000108' }));

      expect(useConsole.getState().selectedIncidentId).toBe('inc-1');
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('opens it from its row as well', async () => {
      useConsole.getState().selectAsset('CT-01', null);
      renderInspector({ incidents: [INCIDENT] });
      const row = screen.getByText('Motor over temperature').closest('button') as HTMLElement;

      await userEvent.click(row);

      expect(useConsole.getState().selectedIncidentId).toBe('inc-1');
      expect(useConsole.getState().selectedAssetCode).toBeNull();
    });

    it('lists several most severe first, and the button names the one the head names', () => {
      renderInspector({ incidents: [INCIDENT, SECOND] });

      expect(
        screen.getByRole('heading', { level: 3, name: 'Incidents raised by this asset' }),
      ).toBeInTheDocument();
      // Each title sits after a visually hidden "Equipment fault: ", so compare positions, not text.
      const critical = screen.getByText('Vibration over limit');
      const high = screen.getByText('Motor over temperature');
      expect(
        critical.compareDocumentPosition(high) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /^Open INC-/ })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Open INC-000109' })).toBeInTheDocument();
      expect(screen.getByText('Fault · INC-000109')).toBeInTheDocument();
    });

    it('draws no section when nothing is open: a resolved incident is not listed', () => {
      const resolved: Incident = { ...INCIDENT, status: 'resolved', resolvedAt: RECEIVED };

      renderInspector({ incidents: [resolved] });

      expect(screen.queryByRole('heading', { name: /raised by this asset/ })).toBeNull();
      expect(screen.getByText('No open incidents')).toBeInTheDocument();
    });

    it("draws no section for another asset's incident", () => {
      renderInspector({ incidents: [{ ...INCIDENT, assetId: 'asset-ct-02' }] });

      expect(screen.queryByRole('heading', { name: /raised by this asset/ })).toBeNull();
    });

    it('draws nothing while the incident list is loading', () => {
      renderInspector();

      expect(screen.queryByRole('heading', { name: /raised by this asset/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Open INC-/ })).toBeNull();
    });

    it('shows the fault of an unmodelled asset with its row, before the note', () => {
      hold({ assets: { 'LKS-B3': sensorEntry() }, afterMs: 400 });
      const leak: Incident = {
        ...INCIDENT,
        id: 'inc-leak',
        assetId: SENSOR.id,
        title: 'Water leak',
      };

      renderInspector({ detail: SENSOR, incidents: [leak] });

      const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
      expect(headings.indexOf('Incident raised by this asset')).toBeGreaterThan(-1);
      expect(headings.indexOf('Incident raised by this asset')).toBeLessThan(
        headings.indexOf('In the twin'),
      );
    });
  });

  describe('the foot', () => {
    beforeEach(() => hold({ assets: { 'CT-01': entry() }, afterMs: 400 }));

    const signInAs = (role: Role) =>
      act(() => useSession.getState().signedIn({ displayName: 'Demo User', roles: [role] }));

    /** The data center's square, around the asset's position `[108.44, 11.95]`. */
    const around = (): Zone => ({
      ...zone,
      polygon: [
        [108.43, 11.94],
        [108.45, 11.94],
        [108.45, 11.96],
        [108.43, 11.96],
        [108.43, 11.94],
      ] satisfies LngLat[],
    });

    it.each(['operator', 'supervisor', 'technician'] as const)(
      'offers a %s a button that opens the report form on the asset',
      async (role) => {
        signInAs(role);
        useConsole.getState().selectAsset('CT-01', null);
        renderInspector({ incidents: [] });

        await userEvent.click(screen.getByRole('button', { name: 'Report a fault on CT-01' }));

        expect(useConsole.getState()).toMatchObject({
          reporting: true,
          selectedAssetCode: null,
          reportZoneId: DETAIL.zoneId,
          reportPreset: {
            category: 'facilities',
            type: 'equipment_fault',
            title: 'Fault — Cooling tower 1 (CT-01)',
          },
        });
        expect(screen.queryByRole('note')).toBeNull();
      },
    );

    it("puts the asset's pin in the preset when it stands inside its zone", async () => {
      signInAs('operator');
      renderInspector({ incidents: [], zones: [around()] });

      await userEvent.click(screen.getByRole('button', { name: 'Report a fault on CT-01' }));

      expect(useConsole.getState().reportPosition).toEqual(DETAIL.position);
    });

    it('puts no pin in the preset for an asset beside its zone, and keeps the zone', async () => {
      signInAs('operator');
      renderInspector({
        detail: { ...DETAIL, position: [108.5, 11.95] },
        incidents: [],
        zones: [around()],
      });

      await userEvent.click(screen.getByRole('button', { name: 'Report a fault on CT-01' }));

      expect(useConsole.getState()).toMatchObject({
        reporting: true,
        reportZoneId: DETAIL.zoneId,
        reportPosition: null,
      });
    });

    it('offers no zone when the console does not have the asset’s zone', async () => {
      signInAs('operator');
      renderInspector({ incidents: [], zones: [] });

      await userEvent.click(screen.getByRole('button', { name: 'Report a fault on CT-01' }));

      expect(useConsole.getState()).toMatchObject({
        reporting: true,
        reportZoneId: null,
        reportPosition: null,
      });
    });

    it.each([
      ['a viewer', () => signInAs('viewer')],
      ['someone signed out', () => undefined],
    ])('shows %s the view-only note in place of the button', (_who, setUp) => {
      setUp();

      renderInspector({ incidents: [] });

      const note = screen.getByRole('note');
      expect(note).toHaveAttribute('data-footer', 'view-only');
      expect(note).toHaveTextContent('View only');
      expect(note).toHaveTextContent(
        'Readings, parts and cameras are all yours to explore. Reporting a fault needs the operator, supervisor or technician role.',
      );
      expect(screen.queryByRole('button', { name: /Report a fault/ })).toBeNull();
    });

    it('changes nothing else in the sheet for a viewer', () => {
      signInAs('viewer');

      renderInspector({ incidents: [INCIDENT] });

      expect(screen.getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
      expect(screen.getByRole('tree', { name: 'Parts of CT-01' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open INC-000108' })).toBeInTheDocument();
    });

    it('is the last thing in the sheet, so it sticks to the bottom', () => {
      signInAs('operator');
      renderInspector({ incidents: [INCIDENT] });

      const sheet = screen.getByRole('complementary', { name: 'Asset CT-01' });
      const foot = screen.getByRole('button', { name: 'Report a fault on CT-01' }).parentElement;

      // The sheet's own status region (the kept-draft announcement) comes after its content.
      const content = Array.from(sheet.children).filter(
        (el) => el.getAttribute('role') !== 'status',
      );
      expect(content.at(-1)).toBe(foot);
    });

    describe('Focus (V2-15.11)', () => {
      const focusButton = () => screen.queryByRole('button', { name: 'Focus' });
      const roles = ['operator', 'supervisor', 'technician', 'viewer'] as const;

      it.each(roles)('is not drawn in the 2D view, for a %s', (role) => {
        signInAs(role);
        useConsole.getState().selectAsset('CT-01', null);

        renderInspector({ incidents: [] });

        expect(focusButton()).toBeNull();
      });

      describe('in the 3D view', () => {
        beforeEach(() => {
          useConsole.setState({ view: '3d' });
          useConsole.getState().selectAsset('CT-01', null);
        });

        it.each(['operator', 'supervisor', 'technician'] as const)(
          'sits beside the report button for a %s and flies to the asset',
          async (role) => {
            signInAs(role);
            renderInspector({ incidents: [] });

            const report = screen.getByRole('button', { name: 'Report a fault on CT-01' });
            expect(report.parentElement).toContainElement(focusButton());
            await userEvent.click(focusButton() as HTMLElement);

            expect(focusSelection).toHaveBeenCalledExactlyOnceWith('CT-01', null);
          },
        );

        it('sits at the end of the viewer’s note and flies to the asset', async () => {
          signInAs('viewer');
          renderInspector({ incidents: [] });

          const note = screen.getByRole('note');
          expect(within(note).getByText('View only')).toBeInTheDocument();
          await userEvent.click(within(note).getByRole('button', { name: 'Focus' }));

          expect(focusSelection).toHaveBeenCalledExactlyOnceWith('CT-01', null);
        });

        it('flies to the selected part when there is one', async () => {
          signInAs('operator');
          useConsole.getState().selectPart('FanBlade');
          renderInspector({ incidents: [] });

          await userEvent.click(focusButton() as HTMLElement);

          expect(focusSelection).toHaveBeenCalledExactlyOnceWith('CT-01', 'FanBlade');
        });

        it.each(roles)(
          'carries the F hint for a %s, which names the key and not the button',
          (role) => {
            signInAs(role);
            renderInspector({ incidents: [] });

            expect(focusButton()).toHaveAttribute('aria-keyshortcuts', 'F');
            expect(
              within(focusButton() as HTMLElement).getByText('F', { selector: 'kbd' }),
            ).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Focus' })).toBeInTheDocument();
          },
        );

        it('has no hint while single-key shortcuts are off', () => {
          signInAs('operator');
          useConsole.setState({ keyboardShortcuts: false });
          renderInspector({ incidents: [] });

          expect(focusButton()).toBeInTheDocument();
          expect(focusButton()).not.toHaveAttribute('aria-keyshortcuts');
          expect(document.querySelector('[aria-keyshortcuts="F"]')).toBeNull();
        });

        it('is not drawn for an asset inside a building that is not in focus, and is when it is', () => {
          signInAs('operator');
          const inside: AssetDetail = { ...DETAIL, elevationM: 0 };

          // Selected with no building in focus (the zones were not known yet): the scene does not draw it.
          const first = renderInspector({ detail: inside, incidents: [], zones: [around()] });
          expect(focusButton()).toBeNull();
          first.unmount();

          useConsole.getState().selectAsset('CT-01', zone.id);
          renderInspector({ detail: inside, incidents: [], zones: [around()] });
          expect(focusButton()).toBeInTheDocument();
        });
      });
    });

    it('is not drawn while the asset loads', () => {
      signInAs('operator');

      renderUncached();

      expect(screen.queryByRole('button', { name: /Report a fault/ })).toBeNull();
      expect(screen.queryByRole('note')).toBeNull();
    });
  });

  describe('re-rendering', () => {
    function renderProfiled() {
      const onRender = vi.fn();
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.asset('CT-01'), DETAIL);
      client.setQueryData(queryKeys.zones, [zone]);
      client.setQueryData(queryKeys.incidents, []);
      client.setQueryData(queryKeys.model(TOWER_URL), TOWER_TREE);
      renderWithQueryClient(
        <Profiler id="inspector" onRender={onRender}>
          <AssetInspector code="CT-01" />
        </Profiler>,
        client,
      );
      return onRender;
    }

    it("does not re-render for another asset's reading, but does for its own", () => {
      const assets = { 'CT-01': entry() };
      hold({ assets, afterMs: 400 });
      const onRender = renderProfiled();
      const before = onRender.mock.calls.length;

      // Another asset's frame: this asset's entry and series are the same references.
      act(() =>
        useTelemetryStore.setState((state) => ({
          view: {
            ...state.view,
            state: {
              ...state.view.state,
              assets: { ...state.view.state.assets, 'CT-02': entry({ fanSpeedRpm: 900 }) },
            },
          },
        })),
      );
      expect(onRender.mock.calls.length).toBe(before);

      act(() =>
        useTelemetryStore.setState((state) => ({
          view: {
            ...state.view,
            state: {
              ...state.view.state,
              assets: { ...state.view.state.assets, 'CT-01': entry({ fanSpeedRpm: 1500 }) },
            },
          },
        })),
      );
      expect(onRender.mock.calls.length).toBeGreaterThan(before);
      // The parts list shows the fan blade's reading too: scope to the readings row.
      expect(within(readingRow('Fan speed')).getByText('1,500 rpm')).toBeInTheDocument();
    });
  });
});
