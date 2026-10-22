import type {
  Asset,
  AssetDetail,
  Camera,
  Incident,
  IncidentDetail,
  Role,
  SitePlan,
  StreamDescriptor,
  TelemetryPoint,
  TelemetryRule,
  TelemetryValue,
  Zone,
} from '@occ/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { queryKeys } from './api/queries';
import { App } from './App';
import { useSession } from './auth/store';
import { AuthGate } from './components/AuthGate';
import { incidentToast } from './lib/attention';
import type { Beacon } from './lib/twinBeacons';
import type { HeatScene } from './lib/twinHeat';
import { SHORTCUTS } from './lib/shortcuts';
import type { FitBox } from './lib/twinCamera';
import { registerTwinCommands, type TwinCommands } from './lib/twinCommands';
import { type FocusResolver, registerFocusResolver } from './lib/twinFocus';
import { levelOf } from './lib/twinLevel';
import { publishPick } from './lib/twinPicker';
import { TWIN_VIEW_KEYS } from './lib/twinSummary';
import { TWIN_UNAVAILABLE_COPY } from './lib/twinCapability';
import { initialTelemetryState } from './lib/telemetryState';
import type { NodeInfo } from './lib/twinBindings';
import { useTelemetryStore } from './realtime/telemetryStore';
import { useConsole } from './store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from './test-utils';
import { showToast, useToasts } from './ui/toasts';

/*
 * The whole console, as `main.tsx` mounts it, checked with axe screen by screen (UI-16 Q2 (b)).
 * Setup per docs/test/unit-react-infra-plan.occ-console.md § "B (b)".
 */

// MapLibre needs WebGL. The map never fires `load` here: the canvas, controls (disabled while there
// is no map), legend and tooltip are DOM and render without it, and layers are invisible to axe.
const fake = vi.hoisted(() => {
  class FakeMap {
    private readonly container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
      // What MapLibre adds to its container: the focusable canvas region.
      const canvas = document.createElement('canvas');
      canvas.className = 'maplibregl-canvas';
      canvas.setAttribute('tabindex', '0');
      canvas.setAttribute('role', 'region');
      canvas.setAttribute('aria-label', 'Map');
      container.append(canvas);
    }
    on = vi.fn(() => this);
    off = vi.fn(() => this);
    remove = vi.fn();
    resize = vi.fn();
    getCanvas = () => this.container.querySelector('canvas')!;
    getContainer = () => this.container;
  }
  /** Inert: the console never connects here; connection states are set in the store per case. */
  const socket = {
    active: true,
    on: vi.fn(),
    io: { on: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return { FakeMap, socket };
});

vi.mock('maplibre-gl', () => ({ default: { Map: fake.FakeMap, Marker: class {} } }));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fake.socket) }));
// R3F needs WebGL too. Only the 3D cases reach the canvas (jsdom has no WebGL 2 otherwise); the rest of
// the stage, its group, controls and legend, is the real one.
// It records the props it is given (V2-16.8: the beacons the stage hands it), and draws the same canvas as ever.
const twinCanvas = vi.hoisted(() => vi.fn());
vi.mock('./twin/TwinCanvas', () => ({
  TwinCanvas: (props: unknown) => {
    twinCanvas(props);
    return <canvas aria-label="3D canvas" />;
  },
}));
/** The beacons the stage handed the canvas in its last render. */
const canvasBeacons = (): readonly Beacon[] =>
  (twinCanvas.mock.lastCall?.[0] as { beacons: readonly Beacon[] } | undefined)?.beacons ?? [];
// Queries ask for a token; the gate's buttons sign in and out.
vi.mock('./auth/session', () => ({
  getAccessToken: vi.fn(() => Promise.resolve(null)),
  renewSession: vi.fn(() => Promise.resolve(false)),
  signInAgain: vi.fn(),
  signOut: vi.fn(),
}));

const ZONES: Zone[] = [
  {
    id: 'z1',
    code: 'BLD-LIB',
    name: 'Library',
    kind: 'building',
    polygon: [
      [108.4412, 11.9527],
      [108.4418, 11.9527],
      [108.4418, 11.9533],
      [108.4412, 11.9533],
      [108.4412, 11.9527],
    ],
    center: [108.4415, 11.953],
  },
];

/**
 * A headline point, so an asset can be judged stale at all: with none, its threshold is unknown and
 * `staleAfterMs` says "cannot judge", which never reads as stale (V2-08.1).
 */
const FAN_SPEED: TelemetryPoint = {
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
};

/** Two assets in the library, so the Assets tab has a catalogue to list and count. */
const ASSETS: Asset[] = ['CT-01', 'CT-02'].map((code, index) => ({
  id: `asset-${index}`,
  code,
  name: `Cooling tower ${index + 1}`,
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'z1',
  position: [108.4415, 11.953],
  elevationM: 0,
  headingDeg: 0,
  headline: [FAN_SPEED],
}));

const SITE_PLAN: SitePlan = {
  id: 's1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: [108.4415, 11.953],
  features: [
    {
      part: 'boundary',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [108.441, 11.9525],
            [108.442, 11.9525],
            [108.442, 11.9535],
            [108.441, 11.9535],
            [108.441, 11.9525],
          ],
        ],
      },
    },
  ],
};

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'i1',
  code: 'INC-000001',
  type: 'fire_alarm',
  severity: 'critical',
  status: 'open',
  title: 'Smoke in the stairwell',
  description: null,
  zoneId: 'z1',
  position: [108.4415, 11.953],
  source: 'operator',
  reportedAt: new Date().toISOString(),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** One per status, so the feed's tabs, severity glyphs and status chips all have something to show. */
const INCIDENTS: Incident[] = [
  incident({}),
  incident({
    id: 'i2',
    code: 'INC-000002',
    type: 'intrusion',
    severity: 'high',
    status: 'acknowledged',
    title: 'Door forced open',
    acknowledgedAt: new Date().toISOString(),
  }),
  incident({
    id: 'i3',
    code: 'INC-000003',
    type: 'equipment_fault',
    severity: 'low',
    status: 'resolved',
    title: 'Card reader offline',
    acknowledgedAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  }),
];

/** An active Facilities incident, the one kind of the list above that a technician may handle. */
const WATER_LEAK = incident({
  id: 'i4',
  code: 'INC-000004',
  type: 'water_leak',
  severity: 'medium',
  title: 'Pipe burst in the library',
});

const camera = (overrides: Partial<Camera>): Camera => ({
  id: 'c1',
  code: 'CAM-L01',
  name: 'Library entrance',
  zoneId: 'z1',
  position: [108.4414, 11.9529],
  online: true,
  fieldOfView: null,
  ...overrides,
});

/** One live camera (its `hls` stream draws a notice, not a canvas) and one offline ("No signal"). */
const CAMERAS: Camera[] = [
  camera({}),
  camera({ id: 'c2', code: 'CAM-L02', name: 'Library reading room', online: false }),
];

const hls = (cameraId: string): StreamDescriptor => ({
  kind: 'hls',
  cameraId,
  label: cameraId,
  url: 'https://video.example/live.m3u8',
});

const detailOf = (item: Incident): IncidentDetail => ({ ...item, timeline: [] });

/*
 * What Phase 3 adds to the pages above (V2-11.5): the tower's motor and the rule that raises its
 * incident, a sensor whose class has no model, and an incident that rule raised, with the note the
 * API writes as its evidence (`formatRuleEvidence`).
 */
const MOTOR_TEMP: TelemetryPoint = {
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  kind: 'number',
  min: -40,
  max: 150,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 2,
};

const MOTOR_RULE: TelemetryRule = {
  name: 'Motor over-temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 60,
  severity: 'critical',
  incidentType: 'equipment_fault',
};

/** `CT-01` with its points and rule: what the inspector and the evidence block read. */
const TOWER: AssetDetail = {
  ...ASSETS[0]!,
  headline: [FAN_SPEED, MOTOR_TEMP],
  points: [FAN_SPEED, MOTOR_TEMP],
  rules: [MOTOR_RULE],
};

const LEAK: TelemetryPoint = {
  key: 'leakDetected',
  label: 'Leak',
  unit: null,
  kind: 'boolean',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
};

/** A class with no model: the inspector draws its neutral box and says so (frame 15). */
const LEAK_SENSOR: AssetDetail = {
  id: 'asset-leak',
  code: 'LKS-B3',
  name: 'Leak sensor, level 3',
  class: {
    id: 'class-leak',
    code: 'leak_sensor',
    name: 'Leak sensor',
    modelUrl: null,
    footprintM: { width: 1.4, depth: 1.4, height: 1.4 },
  },
  zoneId: 'z1',
  position: [108.4415, 11.953],
  elevationM: 8,
  headingDeg: 0,
  headline: [LEAK],
  points: [LEAK],
  rules: [],
};

/** Raised by the motor rule on `CT-01` (`asset-0`), as the demo scenario does (frame 10). */
const RAISED_BY_RULE = incident({
  id: 'i-tel',
  code: 'INC-000101',
  type: 'equipment_fault',
  severity: 'critical',
  title: 'Motor over-temperature — Cooling tower 1',
  source: 'telemetry',
  assetId: 'asset-0',
});

const raisedDetail = (overrides: Partial<IncidentDetail> = {}): IncidentDetail => ({
  ...RAISED_BY_RULE,
  timeline: [
    {
      id: 'event-1',
      kind: 'reported',
      note: 'motorTempC 92 > 85 for 60 s',
      at: new Date().toISOString(),
      actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
    },
  ],
  ...overrides,
});

/** One asset's last reading: how old it is, and its values (the overview's headline and the latest). */
interface Reading {
  ageMs: number;
  values: Record<string, TelemetryValue>;
}

/**
 * Puts readings in the telemetry store with a fixed server clock, so ages stay as the case sets
 * them (`useServerNow` only adds the few milliseconds a case takes). `upstream: 'paused'` is the
 * API saying its source stopped.
 */
function holdTelemetry(readings: Record<string, Reading>, upstream: 'live' | 'paused' = 'live') {
  const now = Date.now();
  const assets = Object.fromEntries(
    Object.entries(readings).map(([code, { ageMs, values }]) => [
      code,
      {
        online: true,
        receivedAt: new Date(now - ageMs).toISOString(),
        headline: values,
        values,
        keyReceivedAt: {},
      },
    ]),
  );
  act(() =>
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          socket: 'live',
          upstream,
          upstreamSince: upstream === 'paused' ? new Date(now - 30_000).toISOString() : null,
          serverClock: { at: now, mono: performance.now() },
          assets,
        },
        series: new Map(),
      },
    }),
  );
}

/*
 * What the heat overlay's cases (V2-17.5) read: three buildings and the indoor climate sensors in them, so the
 * overlay has numbers to colour and the Assets tab has the rows they must equal. The Library is the console's own
 * building and has two sensors (its line is their mean); the Science Lab has one, on a whole degree (the line writes
 * "21.0 °C", the row "21 °C"); the Security Office's only sensor last spoke ten minutes ago, past the 180 s a 60 s
 * point allows, so the building is silent.
 */
const INDOOR_TEMP: TelemetryPoint = {
  key: 'indoorTempC',
  label: 'Indoor temperature',
  unit: '°C',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 60,
  headline: 1,
};

/** A building like the Library's, `index` squares to the east of it. */
function heatBuilding(index: number, id: string, code: string, name: string): Zone {
  const [lng, lat] = [108.4415 + index * 0.001, 11.953];
  const half = 0.0003;
  return {
    id,
    code,
    name,
    kind: 'building',
    heightM: 12,
    polygon: [
      [lng - half, lat - half],
      [lng + half, lat - half],
      [lng + half, lat + half],
      [lng - half, lat + half],
      [lng - half, lat - half],
    ],
    center: [lng, lat],
  };
}

const HEAT_ZONES: Zone[] = [
  ZONES[0]!,
  heatBuilding(1, 'z2', 'BLD-LAB', 'Science Lab'),
  heatBuilding(2, 'z3', 'BLD-SEC', 'Security Office'),
];

/** An indoor climate sensor at the centre of its building. */
const heatSensor = (code: string, name: string, zone: Zone): Asset => ({
  id: `asset-${code}`,
  code,
  name,
  class: {
    id: 'class-indoor-climate',
    code: 'indoor_climate',
    name: 'Indoor climate sensor',
    modelUrl: null,
    footprintM: { width: 0.3, depth: 0.3, height: 0.3 },
  },
  zoneId: zone.id,
  position: zone.center,
  elevationM: 2,
  headingDeg: 0,
  headline: [INDOOR_TEMP],
});

const HEAT_ASSETS: Asset[] = [
  heatSensor('ICS-LIB-A', 'Library sensor A', HEAT_ZONES[0]!),
  heatSensor('ICS-LIB-B', 'Library sensor B', HEAT_ZONES[0]!),
  heatSensor('ICS-LAB', 'Science Lab sensor', HEAT_ZONES[1]!),
  heatSensor('ICS-SEC', 'Security Office sensor', HEAT_ZONES[2]!),
];

const HEAT_READINGS: Record<string, Reading> = {
  'ICS-LIB-A': { ageMs: 400, values: { indoorTempC: 22.2 } },
  'ICS-LIB-B': { ageMs: 400, values: { indoorTempC: 23 } },
  'ICS-LAB': { ageMs: 400, values: { indoorTempC: 21 } },
  'ICS-SEC': { ageMs: 600_000, values: { indoorTempC: 19.8 } },
};

/** The fixture's readings, with `changes` laid over them: the telemetry the heat cases start from. */
const holdHeatTelemetry = (changes: Record<string, Reading> = {}) =>
  holdTelemetry({ ...HEAT_READINGS, ...changes });

/**
 * The state word is announced, the age is not: no live region holds a ticking age ("… ago",
 * "… old"), which a screen reader would read out every few seconds (brief § Accessibility).
 */
function expectNoTickingAgeAnnounced() {
  const regions = [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')];
  for (const region of regions) {
    expect(region.textContent ?? '').not.toMatch(/\b(ago|old)\b/);
  }
}

/** The console as `main.tsx` mounts it (without StrictMode and the top boundary), signed in as `role`. */
function renderConsole({
  role = 'operator',
  incidents = INCIDENTS,
  assets = ASSETS,
  details = [],
  incidentDetails = [],
  models = {},
  zones = ZONES,
  reference = true,
}: {
  role?: Role;
  incidents?: Incident[];
  assets?: Asset[];
  details?: AssetDetail[];
  /** Details with a timeline, for the incidents whose evidence a case reads. */
  incidentDetails?: IncidentDetail[];
  /** Node trees of model files by URL, cached as `useModelParts` resolves them (V2-14.10). */
  models?: Record<string, NodeInfo>;
  /** The site's zones; the heat cases bring three buildings (V2-17.5). */
  zones?: Zone[];
  /** `false` leaves the zones and the site plan out of the cache, so they are still loading. */
  reference?: boolean;
} = {}) {
  useSession.getState().signedIn({ displayName: 'Demo Operator', roles: [role] });
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.assets, assets);
  for (const detail of details) client.setQueryData(queryKeys.asset(detail.code), detail);
  for (const [url, tree] of Object.entries(models)) client.setQueryData(queryKeys.model(url), tree);
  if (reference) {
    client.setQueryData(queryKeys.zones, zones);
    client.setQueryData(queryKeys.sitePlan, SITE_PLAN);
  }
  client.setQueryData(queryKeys.cameras, CAMERAS);
  for (const item of CAMERAS) {
    if (item.online) client.setQueryData(queryKeys.stream(item.id), hls(item.id));
  }
  for (const item of incidents) client.setQueryData(queryKeys.incident(item.id), detailOf(item));
  for (const detail of incidentDetails) client.setQueryData(queryKeys.incident(detail.id), detail);
  return renderWithQueryClient(
    <AuthGate>
      <App />
    </AuthGate>,
    client,
  );
}

describe('the console', () => {
  beforeEach(() => {
    twinCanvas.mockClear();
    resetStore(useConsole);
    resetStore(useSession);
    resetStore(useToasts);
    resetStore(useTelemetryStore);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    // Every query is seeded; a request that slips through stays pending instead of leaving the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders the signed-in console', () => {
    renderConsole();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    // The side column holds both panels; the incident list is a region inside it.
    const side = screen.getByRole('complementary', { name: 'Incidents and assets' });
    expect(within(side).getByRole('region', { name: 'Incidents' })).toBeInTheDocument();
    expect(within(side).getByRole('tab', { name: /^Assets/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Campus map' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cameras' })).toBeInTheDocument();
    expect(screen.getByText('INC-000001')).toBeInTheDocument();
  });

  it('has no axe violations on the overview', async () => {
    renderConsole();

    await expectNoAxeViolations(document.body, { screen: true });
  });

  // UI-16 Q2 (b): every main screen, reached first (so axe never passes on the wrong one), then checked
  // whole with `region` on.
  describe('main screens', () => {
    const consoleState = () => useConsole.getState();
    const checkPage = () => expectNoAxeViolations(document.body, { screen: true });

    it('the overview as a viewer', async () => {
      renderConsole({ role: 'viewer' });

      expect(screen.queryByRole('button', { name: 'Report incident' })).toBeNull();
      await checkPage();
    });

    it('the overview filtered by severity', async () => {
      renderConsole();

      act(() => consoleState().toggleSeverity('critical'));

      // The filter chip has no test file of its own: this is where it is checked (DN-T1).
      expect(screen.getByRole('button', { name: 'Clear severity filter' })).toBeInTheDocument();
      await checkPage();
    });

    it('the Assets tab', async () => {
      renderConsole();

      await userEvent.click(screen.getByRole('tab', { name: /^Assets/ }));

      expect(screen.getByRole('tab', { name: 'Assets 2' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('region', { name: 'Assets' })).toBeInTheDocument();
      expect(screen.getByRole('tablist', { name: 'Filter assets' })).toBeInTheDocument();
      // The incident feed is mounted but hidden: its search box is not in the page for assistive tech.
      expect(screen.queryByRole('searchbox', { name: 'Search incidents' })).toBeNull();
      await checkPage();
    });

    it('the Assets tab, with no assets on the site', async () => {
      renderConsole({ assets: [] });

      await userEvent.click(screen.getByRole('tab', { name: /^Assets/ }));

      expect(screen.getByText('No assets are set up on this site.')).toBeInTheDocument();
      await checkPage();
    });

    // The rows the list draws in V2-09.6: a fault, a stale asset, a class this build lacks, a paused
    // source (the notice), then a zone chosen. Every state is checked whole, with `region` on.
    it('the Assets tab with rows in several states, the notice and a zone chip', async () => {
      const odd: Asset = {
        ...ASSETS[0]!,
        id: 'asset-odd',
        code: 'ODD-01',
        name: 'Odd machine',
        class: { ...ASSETS[0]!.class, code: 'mystery_pump', name: 'Mystery pump' },
      };
      renderConsole({
        incidents: [
          ...INCIDENTS,
          incident({
            id: 'i-fault',
            code: 'INC-000099',
            type: 'equipment_fault',
            title: 'Fan fault',
            assetId: 'asset-0',
          }),
        ],
        assets: [...ASSETS, odd],
      });
      const now = Date.now();
      act(() =>
        useTelemetryStore.setState({
          view: {
            state: {
              ...initialTelemetryState,
              socket: 'live',
              upstream: 'paused',
              upstreamSince: new Date(now - 30_000).toISOString(),
              serverClock: { at: now, mono: performance.now() },
              assets: {
                'CT-02': {
                  online: true,
                  receivedAt: new Date(now - 90_000).toISOString(),
                  headline: {},
                  values: { running: true, fanSpeedRpm: 1420 },
                  keyReceivedAt: {},
                },
              },
            },
            series: new Map(),
          },
        }),
      );

      await userEvent.click(screen.getByRole('tab', { name: /^Assets/ }));

      expect(screen.getByText(/Readings as of .* — not updating/)).toBeInTheDocument();
      expect(screen.getByText(/Fault · INC-000099/)).toBeInTheDocument();
      expect(screen.getByText(/No data · 1 min/)).toBeInTheDocument();
      expect(screen.getByText('mystery_pump')).toBeInTheDocument();
      await checkPage();

      await userEvent.click(screen.getByRole('button', { name: 'Show only Library' }));

      expect(screen.getByRole('button', { name: 'Clear zone filter' })).toBeInTheDocument();
      await checkPage();
    });

    // V2-09.8: an asset takes the sheet. The role cases and the live readings are V2-11.5's and the
    // component's own tests; this is the wiring, and the page checked whole.
    it('an asset in the inspector', async () => {
      // A modelled class, so the page is checked with its Parts tree (read from the model, V2-14.10).
      const modelUrl = '/models/cooling_tower.961e8f9f464e.glb';
      const [tower] = ASSETS;
      renderConsole({
        details: [
          { ...tower!, class: { ...tower!.class, modelUrl }, points: [FAN_SPEED], rules: [] },
        ],
        models: {
          [modelUrl]: {
            name: 'CoolingTower',
            children: [
              { name: 'Casing' },
              {
                name: 'FanBlade',
                extras: { bind: 'fanSpeedRpm', motion: 'spin', axis: 'y', range: [0, 1800] },
              },
            ],
          },
        },
      });

      act(() => consoleState().selectAsset('CT-01', null));

      expect(screen.getByRole('complementary', { name: 'Asset CT-01' })).toBeInTheDocument();
      // Not /^Incident/: the side panel is "Incidents and assets". An incident's sheet is "Incident INC-…".
      expect(screen.queryByRole('complementary', { name: /^Incident INC-/ })).toBeNull();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Cooling tower 1' }),
      ).toBeInTheDocument();
      expect(document.querySelector('[data-sheet="open"]')).not.toBeNull();
      expect(screen.getByRole('tree', { name: 'Parts of CT-01' })).toBeInTheDocument();
      await checkPage();
    });

    it('closes a broken inspector with its fallback, which clears the asset', async () => {
      // React logs the render error it hands to the boundary.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        // No `points`: the inspector throws while it renders.
        renderConsole({ details: [{ ...ASSETS[0]!, points: undefined as never, rules: [] }] });

        act(() => consoleState().selectAsset('CT-01', null));

        expect(await screen.findByText('This panel stopped working.')).toBeInTheDocument();
        const sheet = screen.getByRole('complementary', { name: 'Asset' });

        await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));

        // `select(null)` would have left the asset selected, and Retry would have reopened it.
        expect(consoleState().selectedAssetCode).toBeNull();
        expect(screen.queryByRole('complementary', { name: 'Asset' })).toBeNull();
      } finally {
        logged.mockRestore();
      }
    });

    // V2-11.5: what Phase 3 put on screen, each reached first and then checked whole, with no rule
    // turned off. The map's markers are layers, which the fake map never draws and axe cannot see: the
    // Assets tab and the inspector are the accessible twin of them (brief § Accessibility).
    describe('assets and telemetry', () => {
      const openAssetsTab = () => userEvent.click(screen.getByRole('tab', { name: /^Assets/ }));
      const withLeakSensor = { assets: [...ASSETS, LEAK_SENSOR] };

      it('the Assets tab with live readings', async () => {
        renderConsole();
        holdTelemetry({
          'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, running: true } },
          'CT-02': { ageMs: 400, values: { fanSpeedRpm: 1380, running: true } },
        });

        await openAssetsTab();

        const list = screen.getByRole('region', { name: 'Assets' });
        expect(within(list).getAllByText('Running')).toHaveLength(2);
        expect(within(list).getByText('1,420 rpm')).toBeInTheDocument();
        expectNoTickingAgeAnnounced();
        await checkPage();
      });

      it('the Assets tab with a stale asset', async () => {
        renderConsole();
        holdTelemetry({
          'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, running: true } },
          'CT-02': { ageMs: 90_000, values: { fanSpeedRpm: 1380, running: true } },
        });

        await openAssetsTab();

        const list = screen.getByRole('region', { name: 'Assets' });
        expect(within(list).getByText(/No data · 1 min/)).toBeInTheDocument();
        expect(within(list).getAllByText('Running')).toHaveLength(1);
        await checkPage();
      });

      it('the inspector with live readings', async () => {
        renderConsole({ details: [TOWER] });
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, motorTempC: 71 } } });

        act(() => consoleState().selectAsset('CT-01', null));

        const sheet = screen.getByRole('complementary', { name: 'Asset CT-01' });
        expect(within(sheet).getByRole('heading', { name: 'Live readings' })).toBeInTheDocument();
        // In the readings section: the fan motor's row in the parts list shows the same value.
        const readings = within(sheet).getByRole('region', { name: 'Live readings' });
        expect(within(readings).getByText('71 °C')).toBeInTheDocument();
        expect(
          within(sheet).getByRole('button', { name: 'Report a fault on CT-01' }),
        ).toBeVisible();
        expectNoTickingAgeAnnounced();
        await checkPage();
      });

      it('the inspector with stale readings, which say their age as words', async () => {
        renderConsole({ details: [TOWER] });
        holdTelemetry({
          'CT-01': { ageMs: 72_000, values: { fanSpeedRpm: 1420, motorTempC: 71 } },
        });

        act(() => consoleState().selectAsset('CT-01', null));

        const sheet = screen.getByRole('complementary', { name: 'Asset CT-01' });
        expect(within(sheet).getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
        expect(within(sheet).getByText(/^1 min \d+ s old$/)).toBeInTheDocument();
        expectNoTickingAgeAnnounced();
        await checkPage();
      });

      it('the inspector of an asset whose class has no model', async () => {
        renderConsole({ ...withLeakSensor, details: [LEAK_SENSOR] });
        holdTelemetry({ 'LKS-B3': { ageMs: 400, values: { leakDetected: true } } });

        act(() => consoleState().selectAsset('LKS-B3', null));

        const sheet = screen.getByRole('complementary', { name: 'Asset LKS-B3' });
        expect(within(sheet).getByText('No 3D model')).toBeInTheDocument();
        expect(within(sheet).getByRole('heading', { name: 'In the twin' })).toBeInTheDocument();
        await checkPage();
      });

      it('the inspector as a viewer, whose foot is the view-only note', async () => {
        renderConsole({ role: 'viewer', details: [TOWER] });
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, motorTempC: 71 } } });

        act(() => consoleState().selectAsset('CT-01', null));

        const sheet = screen.getByRole('complementary', { name: 'Asset CT-01' });
        expect(within(sheet).getByRole('note')).toHaveTextContent('View only');
        expect(within(sheet).queryByRole('button', { name: /Report a fault/ })).toBeNull();
        await checkPage();
      });

      it('an incident raised by a telemetry rule, with its evidence live', async () => {
        renderConsole({
          incidents: [...INCIDENTS, RAISED_BY_RULE],
          incidentDetails: [raisedDetail()],
          details: [TOWER],
        });
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { motorTempC: 92 } } });

        act(() => consoleState().select('i-tel'));

        const sheet = screen.getByRole('complementary', { name: 'Incident INC-000101' });
        expect(within(sheet).getByRole('heading', { name: 'Why it was raised' })).toBeVisible();
        expect(within(sheet).getByText('Motor over-temperature')).toBeInTheDocument();
        expect(within(sheet).getByText('92 °C')).toBeInTheDocument();
        expect(within(sheet).getByText('Live')).toBeInTheDocument();
        expect(within(sheet).getByRole('button', { name: 'Open asset CT-01' })).toBeVisible();
        expectNoTickingAgeAnnounced();
        await checkPage();
      });

      it('an incident raised by a telemetry rule, resolved: what it raised, and no live reading', async () => {
        const resolved = {
          status: 'resolved',
          acknowledgedAt: new Date().toISOString(),
          resolvedAt: new Date().toISOString(),
        } as const;
        renderConsole({
          incidents: [...INCIDENTS, { ...RAISED_BY_RULE, ...resolved }],
          incidentDetails: [raisedDetail(resolved)],
          details: [TOWER],
        });
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { motorTempC: 71 } } });

        act(() => consoleState().select('i-tel'));

        const sheet = screen.getByRole('complementary', { name: 'Incident INC-000101' });
        expect(within(sheet).getByText('Raised at 92 °C')).toBeInTheDocument();
        expect(within(sheet).queryByText('Live')).toBeNull();
        await checkPage();
      });

      it('a telemetry incident as a viewer, who keeps the evidence and the link and loses the response', async () => {
        renderConsole({
          role: 'viewer',
          incidents: [...INCIDENTS, RAISED_BY_RULE],
          incidentDetails: [raisedDetail()],
          details: [TOWER],
        });
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { motorTempC: 92 } } });

        act(() => consoleState().select('i-tel'));

        const sheet = screen.getByRole('complementary', { name: 'Incident INC-000101' });
        expect(within(sheet).getByRole('button', { name: 'Open asset CT-01' })).toBeVisible();
        expect(within(sheet).getByRole('note')).toHaveTextContent('View only');
        expect(within(sheet).queryByRole('form', { name: 'Response' })).toBeNull();
        await checkPage();
      });

      // Frames 07 / 14. jsdom has no WebGL 2, so the stage is the 2D map, and the banner, the switch
      // and the layers say so in words (no colour alone).
      it('the 2D view, with the fallback banner, the switch, the layers and the legend', async () => {
        renderConsole();
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, running: true } } });

        // The reason is said twice on purpose: by the banner, and as the 3D option's own description,
        // so nothing is lost once the banner is dismissed (`TwinFallbackBanner`).
        const reason = "3D view isn't available on this device";
        expect(screen.getAllByText(reason)).toHaveLength(2);
        const view = screen.getByRole('group', { name: 'View' });
        expect(within(view).getByRole('button', { name: '2D' })).toBeInTheDocument();
        expect(within(view).getByRole('button', { name: '3D' })).toHaveAccessibleDescription(
          reason,
        );
        expect(screen.getByRole('group', { name: 'Layers' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Legend' })).toHaveAttribute(
          'aria-expanded',
          'true',
        );
        for (const entry of ['Asset', 'Asset fault', 'Asset no data']) {
          expect(screen.getByText(entry)).toBeInTheDocument();
        }
        await checkPage();
      });

      // V2-12.12. jsdom has no WebGL 2, so the cases stub it and ask for 3D. The canvas is
      // the mock above; the group that names it, the controls and the legend are the real ones.
      describe('the 3D stage', () => {
        const show3d = () => {
          stubTwinAvailable();
          act(() => consoleState().setView('3d'));
        };
        const view = () =>
          screen.findByRole('group', { name: /^3D view of Langbiang Tech Campus/ });

        afterEach(() => unstubTwin());

        it.each<Role>(['operator', 'viewer'])('loaded, as a %s', async (role) => {
          renderConsole({ role });

          show3d();

          // INCIDENTS holds two active incidents and one resolved.
          expect(await view()).toHaveAccessibleName(/ with 2 active incidents\. Drag to rotate\. /);
          // The code step is ticked as the chunk resolves, a tick after the stage is there.
          await waitFor(() =>
            expect(screen.getByRole('region', { name: 'Campus 3D view' })).toHaveAttribute(
              'aria-busy',
              'false',
            ),
          );
          expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
          expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
          await checkPage();
        });

        it('loading: the card over the empty stage, while the site plan is on its way', async () => {
          renderConsole({ reference: false });

          show3d();

          const loading = await screen.findByRole('region', { name: 'Campus 3D view, loading' });
          expect(loading).toHaveAttribute('aria-busy', 'true');
          expect(within(loading).getByRole('status')).toHaveTextContent('Loading the 3D view');
          // The summary is there from the first frame; without a plan it speaks of the campus.
          expect(
            await screen.findByRole('group', {
              name: /^3D view of the campus with 2 active incidents/,
            }),
          ).toBeInTheDocument();
          await checkPage();
        });

        // Frames 07 / 14: the context did not come back, so the stage is the 2D map again and the banner says why.
        it('after a lost context: the 2D map, the banner and the disabled 3D option', async () => {
          renderConsole();
          show3d();
          await view();

          act(() => consoleState().markTwinLost());

          const reason = TWIN_UNAVAILABLE_COPY['context-lost'].title;
          expect(screen.queryByRole('group', { name: /^3D view of/ })).toBeNull();
          expect(screen.getByRole('region', { name: 'Campus map' })).toBeInTheDocument();
          // Said twice on purpose: by the banner and as the 3D option's own description.
          expect(screen.getAllByText(reason)).toHaveLength(2);
          expect(screen.getByRole('button', { name: '3D' })).toHaveAccessibleDescription(reason);
          await checkPage();
        });

        // V2-16.8: the incident layer of the stage, with the canvas mocked. The beacons are not drawn here (no WebGL), so
        // what is checked is the DOM that carries their meaning: the tooltip host, the toast, the sheet and the form.
        describe('incidents in 3D (V2-16.8)', () => {
          afterEach(() => {
            act(() => publishPick(null));
          });

          it('with a beacon hovered: the tooltip host names the incident and the page is accessible', async () => {
            renderConsole();
            show3d();
            await view();

            act(() => publishPick({ kind: 'beacon', id: 'i1' }));
            fireEvent.pointerMove(screen.getByLabelText('3D canvas'), {
              clientX: 120,
              clientY: 90,
              pointerType: 'mouse',
            });

            // The tip waits 150 ms of rest on one target; real timers, as axe needs.
            const tip = await screen.findByRole('tooltip', { hidden: true });
            expect(tip).toHaveTextContent('Smoke in the stairwell');
            expect(tip).toHaveTextContent('INC-000001');
            // The stage hands the canvas one beacon for each active incident.
            expect(canvasBeacons().map((beacon) => beacon.code)).toEqual([
              'INC-000001',
              'INC-000002',
            ]);
            await checkPage();
          });

          it('the toast of a new critical incident in 3D, with "Fly to" and "Open incident"', async () => {
            renderConsole();
            show3d();
            await view();

            act(() =>
              showToast(
                incidentToast(
                  INCIDENTS[0]!,
                  { zone: { name: 'Library', kind: 'building', heightM: null } },
                  () => {},
                  () => {},
                )!,
              ),
            );

            const notifications = screen.getByRole('region', { name: 'Notifications' });
            expect(within(notifications).getByRole('button', { name: 'Fly to' })).toBeVisible();
            expect(
              within(notifications).getByRole('button', { name: 'Open incident' }),
            ).toBeVisible();
            expect(
              within(notifications).queryByRole('button', { name: 'View incident' }),
            ).toBeNull();
            await checkPage();
          });

          it.each<Role>(['operator', 'viewer'])(
            'the sheet of a telemetry incident over the stage has both buttons, as a %s',
            async (role) => {
              renderConsole({
                role,
                incidents: [...INCIDENTS, RAISED_BY_RULE],
                incidentDetails: [raisedDetail()],
                details: [TOWER],
              });
              holdTelemetry({ 'CT-01': { ageMs: 400, values: { motorTempC: 92 } } });
              show3d();
              await view();

              act(() => consoleState().select('i-tel'));

              const sheet = screen.getByRole('complementary', { name: 'Incident INC-000101' });
              expect(within(sheet).getByRole('button', { name: 'Open asset CT-01' })).toBeVisible();
              expect(within(sheet).getByRole('button', { name: 'Show in 3D CT-01' })).toBeVisible();
              expectNoTickingAgeAnnounced();
              await checkPage();
            },
          );

          it('the report form while the location is picked: the toggle is pressed and the stage says how to stop', async () => {
            renderConsole();
            show3d();
            await view();
            act(() => consoleState().startReport());

            const pick = screen.getByRole('button', { name: 'Pick in 3D' });
            await userEvent.click(pick);

            expect(pick).toHaveAttribute('aria-pressed', 'true');
            expect(screen.getByText(/Click the scene to place the incident/)).toBeInTheDocument();
            await checkPage();
          });

          it.each<Role>(['operator', 'supervisor', 'technician', 'viewer'])(
            'the sheet of a telemetry incident has "Open asset" and "Show in 3D", as a %s',
            async (role) => {
              renderConsole({
                role,
                incidents: [...INCIDENTS, RAISED_BY_RULE],
                incidentDetails: [raisedDetail()],
                details: [TOWER],
              });
              show3d();
              await view();

              act(() => consoleState().select('i-tel'));

              const sheet = screen.getByRole('complementary', { name: 'Incident INC-000101' });
              expect(within(sheet).getByRole('button', { name: 'Open asset CT-01' })).toBeVisible();
              expect(within(sheet).getByRole('button', { name: 'Show in 3D CT-01' })).toBeVisible();
            },
          );

          // The brief's "Viewer in V2": everything that only reads stays, every action that writes goes.
          it('a viewer has "Fly to", "Open incident" and "Show in 3D", and no report action', async () => {
            renderConsole({
              role: 'viewer',
              incidents: [...INCIDENTS, RAISED_BY_RULE],
              incidentDetails: [raisedDetail()],
              details: [TOWER],
            });
            show3d();
            await view();

            act(() =>
              showToast(
                incidentToast(
                  RAISED_BY_RULE,
                  {},
                  () => {},
                  () => {},
                )!,
              ),
            );
            act(() => consoleState().select('i-tel'));

            const notifications = screen.getByRole('region', { name: 'Notifications' });
            expect(within(notifications).getByRole('button', { name: 'Fly to' })).toBeVisible();
            expect(
              within(notifications).getByRole('button', { name: 'Open incident' }),
            ).toBeVisible();
            const sheet = screen.getByRole('complementary', { name: 'Incident INC-000101' });
            expect(within(sheet).getByRole('button', { name: 'Show in 3D CT-01' })).toBeVisible();
            // The view-only footer replaces the response; no way to start a report or to pick its location.
            expect(within(sheet).getByRole('note')).toHaveTextContent('View only');
            expect(within(sheet).queryByRole('button', { name: 'Acknowledge' })).toBeNull();
            expect(screen.queryByRole('button', { name: 'Report incident' })).toBeNull();
            expect(screen.queryByRole('heading', { name: 'Report an incident' })).toBeNull();
            expect(screen.queryByRole('button', { name: 'Pick in 3D' })).toBeNull();
          });

          // "No role changes what is drawn": the stage reads no session, so the canvas gets the same beacons.
          it.each<Role>(['operator', 'technician', 'viewer'])(
            'the canvas is handed one beacon for each active incident, as a %s',
            async (role) => {
              renderConsole({ role });
              show3d();
              await view();

              expect(
                canvasBeacons().map(({ code, form, selected }) => [code, form, selected]),
              ).toEqual([
                ['INC-000001', 'filled', false],
                ['INC-000002', 'hollow', false],
              ]);
            },
          );

          // Frame 11: a technician selects a Fire & safety incident, which is not theirs to act on.
          it('a technician selecting an incident out of their scope sees the same beacon and the view-only footer', async () => {
            renderConsole({ role: 'technician' });
            show3d();
            await view();

            act(() => consoleState().select('i1'));

            expect(screen.getByRole('note')).toHaveTextContent(
              'Fire & safety incidents are handled by operators',
            );
            expect(screen.queryByRole('form', { name: 'Response' })).toBeNull();
            expect(
              canvasBeacons().map(({ code, form, selected }) => [code, form, selected]),
            ).toEqual([
              ['INC-000001', 'filled', true],
              ['INC-000002', 'hollow', false],
            ]);
            await checkPage();
          });

          // Principle 1: the feed is the accessible twin of the beacons. The summary counts by the feed's rule, and every
          // beacon is a row of it.
          describe('the summary and the feed', () => {
            const feed = () => screen.getByRole('region', { name: 'Incidents' });
            /** What the feed says: the Active tab's count, and how many rows it lists. */
            const feedActive = (count: number) => {
              expect(
                within(feed()).getByRole('tab', { name: `Active ${count}` }),
              ).toBeInTheDocument();
              expect(within(feed()).getAllByRole('listitem')).toHaveLength(count);
            };
            /** Three active incidents (open, acknowledged, open) and a resolved one. */
            const LIST = [...INCIDENTS, WATER_LEAK];

            it('count the same active incidents, and every beacon has a row in the feed', async () => {
              renderConsole({ incidents: LIST });
              show3d();

              expect(await view()).toHaveAccessibleName(/ with 3 active incidents\./);
              feedActive(3);
              const beacons = canvasBeacons();
              expect(beacons).toHaveLength(3);
              for (const { code } of beacons) {
                expect(within(feed()).getByText(code)).toBeInTheDocument();
              }
            });

            it('move together when an incident is acknowledged (still active) and when one is resolved', async () => {
              const { client } = renderConsole({ incidents: LIST });
              show3d();
              await view();
              const update = (id: string, patch: Partial<Incident>) => {
                // A cached update must carry a higher version, or the list keeps the copy it has.
                act(() => {
                  client.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
                    (list ?? []).map((item) =>
                      item.id === id ? { ...item, ...patch, version: item.version + 1 } : item,
                    ),
                  );
                });
              };

              update('i1', { status: 'acknowledged' });
              await waitFor(() =>
                expect(screen.getByRole('group', { name: /^3D view of/ })).toHaveAccessibleName(
                  / with 3 active incidents\./,
                ),
              );
              feedActive(3);
              expect(canvasBeacons()).toHaveLength(3);

              update('i2', { status: 'resolved' });
              await waitFor(() =>
                expect(screen.getByRole('group', { name: /^3D view of/ })).toHaveAccessibleName(
                  / with 2 active incidents\./,
                ),
              );
              feedActive(2);
              expect(canvasBeacons()).toHaveLength(2);
              for (const { code } of canvasBeacons()) {
                expect(within(feed()).getByText(code)).toBeInTheDocument();
              }
            });
          });
        });

        // V2-17.5: the heat overlay in the whole console. The canvas is the mock above, so what is checked is the DOM that
        // carries the overlay's meaning: the toggle, the legend, the picker, the zone labels' lines and the group's name.
        describe('the heat overlay (V2-17.5)', () => {
          const heatOn = () => act(() => consoleState().toggleLayer('heat'));
          const group = () => screen.getByRole('group', { name: /^3D view of/ });
          const picker = () => screen.getByRole('button', { name: 'Colour by Indoor temperature' });
          const heatToggle = () => screen.getByRole('button', { name: 'Heat' });
          /** What the stage handed the canvas in its last render. */
          const canvasHeat = (): HeatScene | null =>
            (twinCanvas.mock.lastCall?.[0] as { heat: HeatScene | null } | undefined)?.heat ?? null;
          const SCALE =
            'Campus coloured by indoor temperature per building, 19 to 27 °C; lighter is warmer.';
          const SILENT = 'Security Office faded: its sensor is silent.';

          /** The 3D view of the fixture's three buildings, with its readings, and the layer on. */
          async function openHeat(role: Role = 'operator') {
            renderConsole({ role, assets: HEAT_ASSETS, zones: HEAT_ZONES });
            holdHeatTelemetry();
            show3d();
            await view();
            heatOn();
            await waitFor(() => expect(canvasHeat()).not.toBeNull());
          }

          // The stage reads no session or permission: the same lines, legend and name for both roles.
          it.each<Role>(['operator', 'viewer'])(
            'on at the campus level: the legend, the closed picker, the lines and the name, as a %s',
            async (role) => {
              await openHeat(role);

              expect(heatToggle()).toHaveAttribute('aria-pressed', 'true');
              const legend = screen.getByRole('note');
              expect(legend).toHaveTextContent('Indoor temperature, by building');
              expect(legend).toHaveTextContent(/19 °C.*23 °C.*27 °C/);
              expect(legend).toHaveTextContent('The Assets tab lists each reading.');
              expect(picker()).toHaveAttribute('aria-expanded', 'false');
              expect(group().getAttribute('aria-label')).toContain(`${SCALE} ${SILENT}`);
              expect(Object.fromEntries(canvasHeat()?.labels ?? [])).toEqual({
                z1: '22.6 °C',
                z2: '21.0 °C',
                z3: 'No data',
              });
              await checkPage();
            },
          );

          it('with the picker open: focus is in its list, with the one option selected', async () => {
            const user = userEvent.setup();
            await openHeat();
            act(() => picker().focus());

            await user.keyboard('{ArrowDown}');

            const list = screen.getByRole('listbox', { name: 'Colour by' });
            expect(picker()).toHaveAttribute('aria-expanded', 'true');
            expect(list).toHaveFocus();
            expect(within(list).getAllByRole('option')).toHaveLength(1);
            expect(within(list).getByRole('option')).toHaveAttribute('aria-selected', 'true');
            expect(screen.getByRole('note')).toBeInTheDocument();
            expect(group().getAttribute('aria-label')).toContain(SCALE);
            await checkPage();
          });

          it('when a sensor stops: the name gains the faded sentence and the line reads No data', async () => {
            renderConsole({ assets: HEAT_ASSETS, zones: HEAT_ZONES });
            holdHeatTelemetry({ 'ICS-SEC': { ageMs: 400, values: { indoorTempC: 19.8 } } });
            show3d();
            await view();
            heatOn();
            // Every sensor speaks: the scale is said, and no building is faded.
            await waitFor(() => expect(group().getAttribute('aria-label')).toContain(SCALE));
            expect(group().getAttribute('aria-label')).not.toContain('faded');
            expect(within(group()).queryByText('No data')).toBeNull();

            // `ICS-SEC` goes quiet: its last reading is now ten minutes old.
            holdHeatTelemetry();

            await waitFor(() => expect(group().getAttribute('aria-label')).toContain(SILENT));
            expect(within(group()).getByText('No data')).toBeInTheDocument();
            await checkPage();
          });

          it('with a building in focus: the legend over the building line and the card with its Indoor row, and nothing at asset level', async () => {
            await openHeat();

            act(() => consoleState().focusBuilding('z2'));

            expect(screen.getByRole('note')).toBeInTheDocument();
            expect(screen.getByText(/Walls see-through/)).toBeInTheDocument();
            const card = screen.getByRole('region', { name: 'Science Lab summary' });
            expect(within(card).getByText('Indoor')).toBeInTheDocument();
            expect(within(card).getByText('21.0 °C')).toBeInTheDocument();
            expect(heatToggle()).toHaveAttribute('aria-pressed', 'true');
            await checkPage();

            // With an asset isolated the layer stays on and draws nothing different: no legend, no picker.
            act(() => consoleState().selectAsset('ICS-LAB', 'z2'));

            expect(screen.queryByRole('note')).toBeNull();
            expect(screen.queryByRole('button', { name: /^Colour by/ })).toBeNull();
            expect(heatToggle()).toHaveAttribute('aria-pressed', 'true');
          });

          // Principle 1 of the brief and the checklist's "No second source of truth": a number the picture states is the
          // number the Assets tab lists. Compared as numbers, because the two write them differently (case 1).
          describe('the numbers match the lists', () => {
            /** The line under a building's name in the zone labels' layer: its temperature, or "No data". */
            const lineOf = (building: string) =>
              within(within(group()).getByText(building)).getByText(/°C$|^No data$/);
            /** The Assets tab's row of a sensor. */
            const rowOf = (sensor: string) => {
              const list = within(screen.getByRole('region', { name: 'Assets' }));
              const row = list.getByText(sensor).closest('button');
              if (row === null) throw new Error(`No row for ${sensor}`);
              return row;
            };
            /** The row's reading, as the list writes it. */
            const rowReading = (sensor: string) => within(rowOf(sensor)).getByText(/°C$/);
            /** Whether the list shows the sensor as reporting, which is the heat overlay's own test of a source. */
            const speaks = (sensor: string) =>
              within(rowOf(sensor)).queryByText(/^No data/) === null;
            const figureOf = (text: string | null) => parseFloat(text ?? '');
            /** The 3D view with the layer on and the Assets tab beside it. */
            async function openBoth() {
              await openHeat();
              await openAssetsTab();
            }

            it('one source: the line is the reading of its sensor, the same number written two ways', async () => {
              await openBoth();

              // The line always writes one decimal (V2-17.1); the row drops a trailing zero (`formatReading`, at most one
              // fraction digit). Same number, two ways of writing it: for the tech lead to settle (V2-17.5, D8), and
              // locked as it is here so a change of either is a decision and not an accident.
              expect(lineOf('Science Lab').textContent).toBe('21.0 °C');
              expect(rowReading('Science Lab sensor').textContent).toBe('21 °C');
              expect(figureOf(lineOf('Science Lab').textContent)).toBe(
                figureOf(rowReading('Science Lab sensor').textContent),
              );
            });

            it('two sources: the line is the mean of their rows, and neither of them', async () => {
              await openBoth();

              const first = figureOf(rowReading('Library sensor A').textContent);
              const second = figureOf(rowReading('Library sensor B').textContent);
              const line = figureOf(lineOf('Library').textContent);

              expect(line).toBeCloseTo((first + second) / 2, 1);
              expect(line).not.toBe(first);
              expect(line).not.toBe(second);
            });

            it('a silent source: the line says No data, and so does the row, which keeps its last known reading', async () => {
              await openBoth();

              expect(lineOf('Security Office').textContent).toBe('No data');
              expect(Number.isNaN(figureOf(lineOf('Security Office').textContent))).toBe(true);
              const row = rowOf('Security Office sensor');
              expect(within(row).getByText(/^No data/)).toBeInTheDocument();
              expect(rowReading('Security Office sensor')).toHaveTextContent('19.8 °C');
            });

            it('move together: a new reading changes the line and the row in the same render', async () => {
              await openBoth();

              holdHeatTelemetry({ 'ICS-LAB': { ageMs: 400, values: { indoorTempC: 24 } } });

              await waitFor(() => expect(lineOf('Science Lab').textContent).toBe('24.0 °C'));
              expect(rowReading('Science Lab sensor').textContent).toBe('24 °C');
            });

            it('at building level the Indoor row of the card is the same number as the line and the row', async () => {
              await openBoth();

              act(() => consoleState().focusBuilding('z2'));

              const card = screen.getByRole('region', { name: 'Science Lab summary' });
              const indoor = within(card).getByText('Indoor').nextElementSibling;
              expect(indoor?.textContent).toBe(lineOf('Science Lab').textContent);
              expect(figureOf(indoor?.textContent ?? null)).toBe(
                figureOf(rowReading('Science Lab sensor').textContent),
              );
            });

            // The rule applied to every building at once, from the rows alone: the mean of the sensors that speak, or
            // "No data" when none does. A building added to the fixture with a line and no row here fails the count.
            it('every building: its line is derived from the rows of its sensors', async () => {
              const sensorsOf: Record<string, string[]> = {
                Library: ['Library sensor A', 'Library sensor B'],
                'Science Lab': ['Science Lab sensor'],
                'Security Office': ['Security Office sensor'],
              };
              await openBoth();

              for (const [building, sensors] of Object.entries(sensorsOf)) {
                const figures = sensors
                  .filter(speaks)
                  .map((sensor) => figureOf(rowReading(sensor).textContent));
                const mean = figures.reduce((sum, figure) => sum + figure, 0) / figures.length;
                const expected = figures.length === 0 ? 'No data' : `${mean.toFixed(1)} °C`;
                expect(lineOf(building).textContent).toBe(expected);
              }
              expect(within(group()).getAllByText(/°C$|^No data$/)).toHaveLength(
                Object.keys(sensorsOf).length,
              );
            });
          });
        });
      });

      it('the header with both pills when telemetry is paused: events live, readings not', async () => {
        renderConsole();
        act(() => consoleState().setConnection('live'));
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420 } } }, 'paused');

        const header = screen.getByRole('banner');
        expect(within(header).getByText('Live')).toBeInTheDocument();
        expect(within(header).getByText('Telemetry paused')).toBeInTheDocument();
        expect(screen.getByText(/Readings as of .* — not updating/)).toBeInTheDocument();
        expectNoTickingAgeAnnounced();
        await checkPage();
      });
    });

    it('an incident selected, as an operator', async () => {
      renderConsole();

      act(() => consoleState().select('i1'));

      expect(
        screen.getByRole('complementary', { name: 'Incident INC-000001' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('form', { name: 'Response' })).toBeInTheDocument();
      await checkPage();
    });

    it('an incident selected, as a viewer', async () => {
      renderConsole({ role: 'viewer' });

      act(() => consoleState().select('i1'));

      expect(screen.getByRole('note')).toHaveTextContent('View only');
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      await checkPage();
    });

    it('an incident selected, as a technician, out of their scope', async () => {
      renderConsole({ role: 'technician' });

      // `i1` is a fire alarm: Fire & safety, not one of a technician's categories (ADR-0021).
      act(() => consoleState().select('i1'));

      expect(screen.getByRole('note')).toHaveTextContent(
        'Fire & safety incidents are handled by operators',
      );
      expect(screen.queryByRole('form', { name: 'Response' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
      await checkPage();
    });

    it('an incident selected, as a technician, out of their scope, pointing to their queue', async () => {
      renderConsole({ role: 'technician', incidents: [...INCIDENTS, WATER_LEAK] });

      act(() => consoleState().select('i1'));

      expect(screen.getByRole('note')).toHaveTextContent(
        'You can follow this one and report new incidents. Your queue is in Mine to handle (1).',
      );
      await checkPage();
    });

    it('the feed as a technician, on Mine to handle', async () => {
      renderConsole({ role: 'technician', incidents: [...INCIDENTS, WATER_LEAK] });

      await userEvent.click(screen.getByRole('tab', { name: /^Mine to handle/ }));

      expect(screen.getByRole('tab', { name: /^Mine to handle/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // No Resolved tab; the tag is text in the row, read with it.
      expect(screen.queryByRole('tab', { name: /^Resolved/ })).toBeNull();
      const row = screen.getByRole('button', { name: /Pipe burst in the library/ });
      expect(within(row).getByText('Facilities')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Smoke in the stairwell/ })).toBeNull();
      await checkPage();
    });

    it('the report form', async () => {
      renderConsole();

      act(() => consoleState().startReport());

      expect(screen.getByRole('heading', { name: 'Report an incident' })).toBeInTheDocument();
      await checkPage();
    });

    it('the report form, as a technician, with both steps and every hint', async () => {
      renderConsole({ role: 'technician' });

      act(() => consoleState().startReport());
      await userEvent.click(screen.getByRole('radio', { name: 'Facilities' }));
      await userEvent.click(screen.getByRole('radio', { name: 'Lift entrapment' }));

      expect(screen.getByText('Suggested for lift entrapment: High.')).toBeInTheDocument();
      expect(screen.getByText(/incidents go to the technician queue/)).toBeInTheDocument();
      await checkPage();
    });

    it('the resolve confirmation', async () => {
      renderConsole();
      act(() => consoleState().select('i1'));

      // A critical incident without a note asks first.
      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      expect(
        screen.getByRole('dialog', { name: 'Resolve INC-000001 without a note?' }),
      ).toBeInTheDocument();
      await checkPage();
    });

    it('a critical incident toast', async () => {
      renderConsole();

      act(() =>
        showToast(
          incidentToast(
            INCIDENTS[0]!,
            { zone: { name: 'Library', kind: 'building', heightM: null } },
            () => {},
          )!,
        ),
      );

      const notifications = screen.getByRole('region', { name: 'Notifications' });
      expect(within(notifications).getByText('Smoke in the stairwell')).toBeInTheDocument();
      await checkPage();
    });

    it('offline', async () => {
      renderConsole();

      act(() => consoleState().setConnection('offline'));

      expect(screen.getByText(/Live updates paused since/)).toBeInTheDocument();
      expect(screen.getByText(/Showing incidents as of/)).toBeInTheDocument();
      await checkPage();
    });

    it('the session-expired banner over the console', async () => {
      renderConsole();

      act(() => useSession.getState().expire());

      expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired.');
      await checkPage();
    });

    it('the camera viewer', async () => {
      renderConsole();

      act(() => consoleState().openViewer('c1'));

      expect(
        screen.getByRole('dialog', { name: 'Library entrance · CAM-L01' }),
      ).toBeInTheDocument();
      await checkPage();
    });

    it('the account menu open', async () => {
      renderConsole();

      await userEvent.click(screen.getByRole('button', { name: /Demo Operator/ }));

      const menu = screen.getByRole('group', { name: 'Account' });
      // Sound, single-key shortcuts and compact layout.
      expect(within(menu).getAllByRole('switch')).toHaveLength(3);
      await checkPage();
    });

    it('the keyboard shortcuts help', async () => {
      renderConsole();

      act(() => consoleState().openShortcutHelp());

      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
      await checkPage();
    });

    // V2-18.4: the keyboard at the level of the whole console. The units are proved elsewhere (`shortcuts.test.ts`,
    // `ShortcutHelp.test.tsx`, `TwinShortcuts.test.tsx`, `TwinView.test.tsx`); what is proved here is that the dialog the
    // user opens with `?` lists, in the real console, what the real handlers do. The canvas is a mock (jsdom has no
    // WebGL), so the camera is a fake rig and "which box?" a fake resolver, registered by the case that needs them.
    describe('the keyboard (V2-18.4)', () => {
      const BOX: FitBox = { bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, heightM: 5 };
      type FakeRig = { [K in keyof TwinCommands]: Mock<TwinCommands[K]> };
      const cleanups: (() => void)[] = [];

      /** A rig that answers every camera command, registered until the case ends. */
      function fakeRig(): FakeRig {
        const rig: FakeRig = {
          flyTo: vi.fn<TwinCommands['flyTo']>(),
          home: vi.fn<TwinCommands['home']>(),
          fit: vi.fn<TwinCommands['fit']>(),
          fitAsset: vi.fn<TwinCommands['fitAsset']>(),
          flyToIncident: vi.fn<TwinCommands['flyToIncident']>(),
          showAsset: vi.fn<TwinCommands['showAsset']>(),
          zoomBy: vi.fn<TwinCommands['zoomBy']>(),
          rotateBy: vi.fn<TwinCommands['rotateBy']>(),
          tiltBy: vi.fn<TwinCommands['tiltBy']>(),
          panBy: vi.fn<TwinCommands['panBy']>(),
          faceNorth: vi.fn<TwinCommands['faceNorth']>(),
          panStep: vi.fn<TwinCommands['panStep']>(),
          panHold: vi.fn<TwinCommands['panHold']>(),
          centreOn: vi.fn<TwinCommands['centreOn']>(),
          current: vi.fn<TwinCommands['current']>(() => null),
        };
        cleanups.push(registerTwinCommands(rig));
        return rig;
      }

      /** What the canvas would answer to "which box is this asset or part?". */
      function fakeResolver() {
        const resolver = vi.fn<FocusResolver>(() => BOX);
        cleanups.push(registerFocusResolver(resolver));
        return resolver;
      }

      /** Every call any camera command got. `current` only reads, so it is left out. */
      const cameraCalls = (rig: FakeRig): unknown[][] =>
        Object.entries(rig)
          .filter(([name]) => name !== 'current')
          .flatMap(([, command]) => (command as Mock<(...args: never[]) => unknown>).mock.calls);

      /**
       * Forgets what the rig was asked so far. Selecting an asset or leaving a level makes the level camera fly by itself
       * (V2-15.6); a case that checks what a *key* asked for sets its state up first and clears the rig.
       */
      const clearRig = (rig: FakeRig) =>
        Object.values(rig).forEach((command) => command.mockClear());

      afterEach(() => {
        cleanups.splice(0).forEach((cleanup) => cleanup());
        unstubTwin();
        localStorage.clear();
      });

      const stage = () => screen.findByRole('group', { name: /^3D view of Langbiang Tech Campus/ });

      const helpDialog = () => screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
      const openHelp = () => act(() => consoleState().openShortcutHelp());
      const closeHelp = () => act(() => consoleState().closeShortcutHelp());
      /** What the open help lists under `title`, in order, or `null` when it does not list that group at all. */
      const helpRows = (title: string): string[] | null => {
        const heading = within(helpDialog()).queryByRole('heading', { level: 3, name: title });
        if (heading === null) return null;
        return [...heading.parentElement!.querySelectorAll('dd')].map(
          (row) => row.textContent ?? '',
        );
      };
      /** What the table of keys (`SHORTCUTS`) says the group reads, for the groups that are listed whole. */
      const descriptionsOf = (title: string): string[] =>
        SHORTCUTS.find((group) => group.title === title)!.rows.map((row) => row.description);

      const THREE_D_GROUPS = [
        '3D view, while it has focus',
        '3D view, pointer and touch',
        'Asset inspector',
      ];

      /** What the help shows each role: reporting, and acknowledging and resolving (a technician's are scoped, ADR-0021). */
      const ROLES: readonly {
        role: Role;
        report: boolean;
        acknowledge: string | null;
        resolve: string | null;
      }[] = [
        { role: 'operator', report: true, acknowledge: 'Acknowledge', resolve: 'Resolve' },
        { role: 'supervisor', report: true, acknowledge: 'Acknowledge', resolve: 'Resolve' },
        {
          role: 'technician',
          report: true,
          acknowledge: 'Acknowledge — Facilities and Environment incidents',
          resolve: 'Resolve — Facilities and Environment incidents',
        },
        { role: 'viewer', report: false, acknowledge: null, resolve: null },
      ];

      describe('the help, with 3D available', () => {
        it.each(ROLES)(
          'lists what applies to a $role and has no axe violations',
          async ({ role, report, acknowledge, resolve }) => {
            stubTwinAvailable();
            renderConsole({ role });

            openHelp();

            // V, F and the 3D keys need no permission; N, A and R follow the role.
            expect(helpRows('Anywhere')).toEqual([
              ...(report ? ['Report an incident'] : []),
              'Search incidents or assets',
              'Switch between 3D and 2D',
              'Fly to the selection',
              'Switch the drag between Orbit and Pan',
              'Show keyboard shortcuts',
            ]);
            expect(helpRows('Incident panel')).toEqual([
              ...(acknowledge === null ? [] : [acknowledge]),
              ...(resolve === null ? [] : [resolve]),
              "Show the incident's asset in 3D",
              'Close the panel (kept open while a draft is written)',
            ]);
            for (const title of THREE_D_GROUPS) {
              expect(helpRows(title)).toEqual(descriptionsOf(title));
            }
            await checkPage();
          },
        );

        it('lists the pointer and touch rows with 3D, and no 3D group without it', () => {
          stubTwinAvailable();
          renderConsole();

          openHelp();
          expect(helpRows('3D view, pointer and touch')).toEqual(
            descriptionsOf('3D view, pointer and touch'),
          );
          closeHelp();

          unstubTwin();
          openHelp();
          for (const title of THREE_D_GROUPS) expect(helpRows(title)).toBeNull();
        });
      });

      describe('with single-key shortcuts off (WCAG 2.1.4)', () => {
        it('takes V and F out of the help and out of the console, and keeps the 3D keys listed and working', async () => {
          stubTwinAvailable();
          renderConsole({ details: [TOWER] });
          act(() => consoleState().setView('3d'));
          const view = await stage();
          act(() => {
            consoleState().selectAsset('CT-01', null);
            consoleState().setKeyboardShortcuts(false);
          });
          const rig = fakeRig();
          const resolver = fakeResolver();

          openHelp();
          // Every key of "Anywhere" is a character key; the panels keep only their Escape.
          expect(helpRows('Anywhere')).toBeNull();
          expect(helpRows('Incident panel')).toEqual([
            'Close the panel (kept open while a draft is written)',
          ]);
          expect(helpRows('Asset inspector')).toEqual([
            'Close the part callout, then the inspector',
          ]);
          expect(helpRows('3D view, while it has focus')).toEqual(
            descriptionsOf('3D view, while it has focus'),
          );
          closeHelp();

          fireEvent.keyDown(document.body, { key: 'v' });
          fireEvent.keyDown(document.body, { key: 'f' });
          expect(consoleState().view).toBe('3d');
          expect(resolver).not.toHaveBeenCalled();
          expect(cameraCalls(rig)).toEqual([]);

          // The stage's own keys act only on its focus, so the switch does not touch them.
          act(() => view.focus());
          fireEvent.keyDown(view, { key: 'ArrowLeft' });
          expect(rig.rotateBy).toHaveBeenCalledExactlyOnceWith(15);
        });
      });

      // The guard of the ticket: every keyboard row that frame 16 adds for 3D is listed in the real help *and* done by the
      // real handler. Each case asserts both halves, so removing the handler or the row turns one of them red; the
      // completeness case below turns a new row, or a dropped entry, red. The pointer and touch rows have no keyboard
      // handler to test here (camera-controls and the picker need WebGL) and V1's rows have tests of their own.
      describe('every key of frame 16 (V2-18.4)', () => {
        interface KeyContext {
          rig: FakeRig;
          resolver: Mock<FocusResolver>;
          view: HTMLElement;
        }
        interface KeyEntry {
          group: string;
          description: string;
          render?: Parameters<typeof renderConsole>[0];
          /** Sets the console up, presses the key and checks what it did. */
          run: (context: KeyContext) => void;
        }

        /** A key pressed on the focused stage, the only place the view's own keys are heard. */
        const onStage = (view: HTMLElement, init: KeyboardEventInit) => {
          act(() => view.focus());
          fireEvent.keyDown(view, init);
        };
        const select = (action: () => void, rig: FakeRig) => {
          act(action);
          clearRig(rig);
        };
        const level = () => levelOf(consoleState());

        const FRAME_16_KEYS: readonly KeyEntry[] = [
          {
            group: 'Anywhere',
            description: 'Switch between 3D and 2D',
            run: () => {
              fireEvent.keyDown(document.body, { key: 'v' });
              expect(consoleState().view).toBe('2d');
              fireEvent.keyDown(document.body, { key: 'v' });
              expect(consoleState().view).toBe('3d');
            },
          },
          {
            group: 'Anywhere',
            description: 'Switch the drag between Orbit and Pan',
            run: () => {
              fireEvent.keyDown(document.body, { key: 'p' });
              expect(consoleState().panTool).toBe(true);
              fireEvent.keyDown(document.body, { key: 'p' });
              expect(consoleState().panTool).toBe(false);
            },
          },
          {
            group: 'Anywhere',
            description: 'Fly to the selection',
            render: { details: [TOWER] },
            run: ({ rig, resolver }) => {
              select(() => consoleState().selectAsset('CT-01', null), rig);

              fireEvent.keyDown(document.body, { key: 'f' });

              expect(resolver).toHaveBeenCalledExactlyOnceWith('CT-01', null);
              expect(rig.fitAsset).toHaveBeenCalledExactlyOnceWith(BOX);
            },
          },
          {
            group: 'Incident panel',
            description: "Show the incident's asset in 3D",
            render: {
              incidents: [...INCIDENTS, RAISED_BY_RULE],
              incidentDetails: [raisedDetail()],
              details: [TOWER],
            },
            run: ({ rig }) => {
              select(() => consoleState().select('i-tel'), rig);

              fireEvent.keyDown(document.body, { key: 'f' });

              expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
            },
          },
          {
            group: 'Asset inspector',
            description: 'Fly to the asset or the selected part',
            render: { details: [TOWER] },
            run: ({ rig, resolver }) => {
              select(() => {
                consoleState().selectAsset('CT-01', null);
                consoleState().selectPart('FanBlade');
              }, rig);

              fireEvent.keyDown(document.body, { key: 'f' });

              expect(resolver).toHaveBeenCalledExactlyOnceWith('CT-01', 'FanBlade');
              expect(rig.fitAsset).toHaveBeenCalledExactlyOnceWith(BOX);
            },
          },
          {
            group: '3D view, while it has focus',
            description: 'Orbit around the target',
            run: ({ rig, view }) => {
              onStage(view, { key: 'ArrowLeft' });
              onStage(view, { key: 'ArrowRight' });

              expect(rig.rotateBy.mock.calls).toEqual([[15], [-15]]);
            },
          },
          {
            group: '3D view, while it has focus',
            description: 'Tilt (20°–78°)',
            run: ({ rig, view }) => {
              onStage(view, { key: 'ArrowUp' });
              onStage(view, { key: 'ArrowDown' });

              expect(rig.tiltBy.mock.calls).toEqual([[-5], [5]]);
            },
          },
          {
            group: '3D view, while it has focus',
            description: 'Pan',
            run: ({ rig, view }) => {
              onStage(view, { key: 'ArrowLeft', shiftKey: true });
              onStage(view, { key: 'ArrowUp', shiftKey: true });

              expect(rig.panBy.mock.calls).toEqual([
                [-0.1, 0],
                [0, 0.1],
              ]);
              // Shift turns an arrow into a pan; it is not also an orbit or a tilt.
              expect(rig.rotateBy).not.toHaveBeenCalled();
              expect(rig.tiltBy).not.toHaveBeenCalled();
            },
          },
          {
            group: '3D view, while it has focus',
            description: 'Zoom in or out',
            run: ({ rig, view }) => {
              onStage(view, { key: '+' });
              onStage(view, { key: '-' });

              expect(rig.zoomBy.mock.calls).toEqual([[0.8], [1.25]]);
            },
          },
          {
            group: '3D view, while it has focus',
            description: 'Reset to the campus view',
            render: { details: [TOWER] },
            run: ({ rig, view }) => {
              select(() => consoleState().selectAsset('CT-01', null), rig);
              expect(level()).toBe('asset');

              onStage(view, { key: 'Home' });

              expect(level()).toBe('campus');
              expect(rig.home).toHaveBeenCalled();
            },
          },
          {
            group: '3D view, while it has focus',
            description: 'Up one level: part → asset → building → campus',
            render: { details: [TOWER] },
            run: ({ rig, view }) => {
              select(() => {
                consoleState().selectAsset('CT-01', 'z1');
                consoleState().selectPart('FanBlade');
              }, rig);
              expect(level()).toBe('part');

              for (const next of ['asset', 'building', 'campus']) {
                onStage(view, { key: 'Escape' });
                expect(level()).toBe(next);
              }
              // The level camera flew home when the building was left; the key asked for nothing else.
              expect(rig.home).toHaveBeenCalled();

              // At the campus there is nothing to close, and Escape does not leave the 3D view.
              const before = consoleState();
              onStage(view, { key: 'Escape' });
              expect(consoleState()).toBe(before);
              expect(consoleState().view).toBe('3d');
            },
          },
          {
            group: 'Asset inspector',
            description: 'Close the part callout, then the inspector',
            render: { details: [TOWER] },
            run: ({ rig }) => {
              select(() => {
                consoleState().selectAsset('CT-01', null);
                consoleState().selectPart('FanBlade');
              }, rig);
              const sheet = screen.getByRole('complementary', { name: 'Asset CT-01' });

              fireEvent.keyDown(sheet, { key: 'Escape' });
              expect(consoleState().selectedPart).toBeNull();
              expect(consoleState().selectedAssetCode).toBe('CT-01');

              fireEvent.keyDown(sheet, { key: 'Escape' });
              expect(consoleState().selectedAssetCode).toBeNull();
            },
          },
        ];

        it.each(FRAME_16_KEYS)(
          'lists "$description" under "$group", and the key does it',
          async ({ group, description, render, run }) => {
            stubTwinAvailable();
            renderConsole(render);
            act(() => consoleState().setView('3d'));
            const view = await stage();
            const rig = fakeRig();
            const resolver = fakeResolver();

            // The row is in the help the user would open with `?`. The dialog swallows every key, so it is closed
            // before the key is pressed.
            openHelp();
            expect(helpRows(group)).toContain(description);
            closeHelp();

            run({ rig, resolver, view });
          },
        );

        it('has an entry for every keyboard row that frame 16 lists for 3D, and for nothing else', () => {
          const rows = SHORTCUTS.filter((group) => group.title !== '3D view, pointer and touch')
            .flatMap((group) =>
              group.rows
                .filter((row) => row.requires === 'twin')
                .map((row) => `${group.title} › ${row.description}`),
            )
            .sort();

          expect(
            FRAME_16_KEYS.map((entry) => `${entry.group} › ${entry.description}`).sort(),
          ).toEqual(rows);
        });

        it('has no entry twice', () => {
          const names = FRAME_16_KEYS.map((entry) => `${entry.group} › ${entry.description}`);

          expect(new Set(names).size).toBe(names.length);
        });
      });

      // What the keyboard user does, with the keyboard alone and the real console: no `focus()` to get to a control, no
      // store call to select or to climb. The canvas, the camera and "which box?" are the fakes above, so this proves the
      // keys, their scoping and the hand-offs, not the camera itself (by eye, V2-19.7).
      describe('by keyboard alone (V2-18.4)', () => {
        /** Presses Tab until `found` is true (Tab wraps round the page), and says where it got lost if it never is. */
        const tabTo = async (found: () => boolean) => {
          for (let presses = 0; presses < 120; presses += 1) {
            if (found()) return;
            await userEvent.tab();
          }
          throw new Error(
            `Tab did not reach its target in 120 presses; focus is on ${document.activeElement?.outerHTML.slice(0, 160)}`,
          );
        };

        it('reaches the stage, orbits, picks an asset, flies to it with F and goes back up with Escape', async () => {
          stubTwinAvailable();
          renderConsole({ details: [TOWER] });
          act(() => consoleState().setView('3d'));
          const view = await stage();
          const rig = fakeRig();
          const resolver = fakeResolver();

          // The stage is one tab stop, described by the sentence that names its keys.
          await tabTo(() => document.activeElement === view);
          expect(view).toHaveAccessibleDescription(TWIN_VIEW_KEYS);
          await userEvent.keyboard('{ArrowLeft}');
          expect(rig.rotateBy).toHaveBeenCalledExactlyOnceWith(15);

          // The Assets tab with the arrow (automatic activation), then its first asset with Enter.
          await tabTo(() => document.activeElement?.getAttribute('role') === 'tab');
          expect(document.activeElement).toHaveAccessibleName(/^Incidents/);
          await userEvent.keyboard('{ArrowRight}');
          expect(screen.getByRole('tab', { name: /^Assets/ })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          const assets = within(screen.getByRole('region', { name: 'Assets' }));
          const row = assets.getByRole('button', { name: /Cooling tower 1/ });
          // The list is one tab stop (a roving tabindex, headers among its items): Tab reaches that stop and the arrows
          // walk to the row.
          const stop = () =>
            assets.getAllByRole('button').find((button) => button.getAttribute('tabindex') === '0');
          await tabTo(() => document.activeElement === stop());
          for (let steps = 0; steps < 10 && document.activeElement !== row; steps += 1) {
            await userEvent.keyboard('{ArrowDown}');
          }
          expect(row).toHaveFocus();
          await userEvent.keyboard('{Enter}');
          const sheet = await screen.findByRole('complementary', { name: 'Asset CT-01' });
          expect(consoleState().selectedAssetCode).toBe('CT-01');
          // Selecting made the level camera fly by itself; what comes next is the key's.
          clearRig(rig);

          // F flies to the selection, and the button that does the same says so.
          expect(within(sheet).getByRole('button', { name: /^Focus/ })).toHaveAttribute(
            'aria-keyshortcuts',
            'F',
          );
          await userEvent.keyboard('f');
          expect(resolver).toHaveBeenCalledExactlyOnceWith('CT-01', null);
          expect(rig.fitAsset).toHaveBeenCalledExactlyOnceWith(BOX);

          // Back to the stage by Tab, and Escape climbs: the asset, then the building the row put in focus, if any.
          await tabTo(() => document.activeElement === view);
          clearRig(rig);
          await userEvent.keyboard('{Escape}');
          expect(consoleState().selectedAssetCode).toBeNull();
          if (consoleState().focusZoneId !== null) await userEvent.keyboard('{Escape}');
          expect(levelOf(consoleState())).toBe('campus');
          expect(rig.home).toHaveBeenCalled();

          // At the campus Escape does nothing, and the operator is still in the 3D view.
          const before = consoleState();
          await userEvent.keyboard('{Escape}');
          expect(consoleState()).toBe(before);
          expect(consoleState().view).toBe('3d');
        });

        it('fires no handler from a text field', async () => {
          stubTwinAvailable();
          renderConsole({ details: [TOWER] });
          act(() => consoleState().setView('3d'));
          await stage();
          act(() => consoleState().selectAsset('CT-01', null));
          const rig = fakeRig();
          const resolver = fakeResolver();

          for (const [tab, placeholder] of [
            [/^Incidents/, 'Search code, title or zone'],
            [/^Assets/, 'Search asset, code or zone'],
          ] as const) {
            await userEvent.click(screen.getByRole('tab', { name: tab }));
            const box = screen.getByPlaceholderText(placeholder);
            await userEvent.click(box);

            // The single-key shortcuts only type: V, F, N, A, R, ? and /.
            await userEvent.type(box, 'vfnar?/');
            expect(box).toHaveValue('vfnar?/');
            expect(consoleState()).toMatchObject({
              view: '3d',
              selectedAssetCode: 'CT-01',
              reporting: false,
              shortcutHelpOpen: false,
            });
            expect(resolver).not.toHaveBeenCalled();
            expect(cameraCalls(rig)).toEqual([]);

            // The stage's keys are heard on the stage only: sent to the box they reach no camera and no level.
            await userEvent.clear(box);
            for (const init of [
              { key: 'Home' },
              { key: 'ArrowLeft' },
              { key: 'ArrowUp', shiftKey: true },
              { key: '+' },
              { key: '-' },
              { key: 'Escape' },
            ]) {
              fireEvent.keyDown(box, init);
            }
            expect(levelOf(consoleState())).toBe('asset');
            expect(cameraCalls(rig)).toEqual([]);
          }
        });

        it('keeps Home for the lists, and gives it to the stage only while the stage has focus', async () => {
          stubTwinAvailable();
          renderConsole({ details: [TOWER] });
          act(() => consoleState().setView('3d'));
          const view = await stage();
          const rig = fakeRig();

          // A list's rows are the buttons with a roving tabindex; the headers of the Assets list are among them.
          const items = (name: string) =>
            within(screen.getByRole('region', { name }))
              .getAllByRole('button')
              .filter((button) => button.hasAttribute('tabindex'));
          for (const [tab, region] of [
            [/^Incidents/, 'Incidents'],
            [/^Assets/, 'Assets'],
          ] as const) {
            await userEvent.click(screen.getByRole('tab', { name: tab }));
            const rows = items(region);
            expect(rows.length).toBeGreaterThan(1);
            act(() => rows.at(-1)!.focus());

            await userEvent.keyboard('{Home}');

            expect(rows[0]).toHaveFocus();
          }
          expect(cameraCalls(rig)).toEqual([]);

          // With the stage focused the same key is the reset.
          act(() => consoleState().selectAsset('CT-01', null));
          clearRig(rig);
          act(() => view.focus());
          await userEvent.keyboard('{Home}');
          expect(levelOf(consoleState())).toBe('campus');
          expect(rig.home).toHaveBeenCalled();
        });
      });
    });
  });
});
