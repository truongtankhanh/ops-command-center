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
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from './api/queries';
import { App } from './App';
import { useSession } from './auth/store';
import { AuthGate } from './components/AuthGate';
import { incidentToast } from './lib/attention';
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
// R3F needs WebGL too. Only the 3D cases reach the canvas (the preview gate is closed otherwise); the rest of
// the stage, its group, controls and legend, is the real one.
vi.mock('./twin/TwinCanvas', () => ({ TwinCanvas: () => <canvas aria-label="3D canvas" /> }));
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
    client.setQueryData(queryKeys.zones, ZONES);
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

      act(() => consoleState().selectAsset('CT-01'));

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

        act(() => consoleState().selectAsset('CT-01'));

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

        act(() => consoleState().selectAsset('CT-01'));

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

        act(() => consoleState().selectAsset('CT-01'));

        const sheet = screen.getByRole('complementary', { name: 'Asset CT-01' });
        expect(within(sheet).getByRole('heading', { name: 'Last readings' })).toBeInTheDocument();
        expect(within(sheet).getByText(/^1 min \d+ s old$/)).toBeInTheDocument();
        expectNoTickingAgeAnnounced();
        await checkPage();
      });

      it('the inspector of an asset whose class has no model', async () => {
        renderConsole({ ...withLeakSensor, details: [LEAK_SENSOR] });
        holdTelemetry({ 'LKS-B3': { ageMs: 400, values: { leakDetected: true } } });

        act(() => consoleState().selectAsset('LKS-B3'));

        const sheet = screen.getByRole('complementary', { name: 'Asset LKS-B3' });
        expect(within(sheet).getByText('No 3D model')).toBeInTheDocument();
        expect(within(sheet).getByRole('heading', { name: 'In the twin' })).toBeInTheDocument();
        await checkPage();
      });

      it('the inspector as a viewer, whose foot is the view-only note', async () => {
        renderConsole({ role: 'viewer', details: [TOWER] });
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, motorTempC: 71 } } });

        act(() => consoleState().selectAsset('CT-01'));

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

      // Frames 07 / 14. The twin is not built, so the stage is the 2D map, and the banner, the switch
      // and the layers say so in words (no colour alone).
      it('the 2D view, with the fallback banner, the switch, the layers and the legend', async () => {
        renderConsole();
        holdTelemetry({ 'CT-01': { ageMs: 400, values: { fanSpeedRpm: 1420, running: true } } });

        // The reason is said twice on purpose: by the banner, and as the 3D option's own description,
        // so nothing is lost once the banner is dismissed (`TwinFallbackBanner`).
        const reason = "3D view isn't available in this version";
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

      // V2-12.12. The twin is still behind the preview gate, so the cases open it and ask for 3D. The canvas is
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
  });
});
