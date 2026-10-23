import type {
  AssetDetail,
  IncidentDetail,
  IncidentEvent,
  TelemetryPoint,
  TelemetryRule,
  Zone,
} from '@occ/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useSession } from '../auth/store';
import { type AssetTelemetryState, initialTelemetryState } from '../lib/telemetry/telemetryState';
import type { NodeInfo } from '../lib/twin-core/twinBindings';
import { registerTwinCommands, type TwinCommands } from '../lib/twin-core/twinCommands';
import { seriesKey, type SeriesView } from '../realtime/telemetryClient';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
  stubTwinAvailable,
  unstubTwin,
} from '../test-utils';
import { IncidentEvidence } from './IncidentEvidence';

// The session module is tested on its own; here it only decides which token the client sends.
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

const RECEIVED = '2026-10-16T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'motorTempC',
  label: 'Motor temperature',
  unit: '°C',
  kind: 'number',
  min: -40,
  max: 150,
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

const TEMP = point();
const LEAK = point({
  key: 'leakDetected',
  label: 'Leak',
  unit: null,
  kind: 'boolean',
  min: null,
  max: null,
});

const TOWER_URL = '/models/cooling_tower.961e8f9f464e.glb';

/** The node tree of the tower's model, as `useModelParts` resolves it: a static part and the bound motor. */
const TOWER_TREE: NodeInfo = {
  name: 'CoolingTower',
  children: [
    { name: 'Casing' },
    { name: 'FanMotor', extras: { bind: 'motorTempC', motion: 'tint', label: 'Fan motor' } },
  ],
};

const asset = (overrides: Partial<AssetDetail>): AssetDetail => ({
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
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 14,
  headingDeg: 0,
  headline: [TEMP],
  points: [TEMP],
  rules: [rule()],
  ...overrides,
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

const COOLING_TOWER = asset({});
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
  points: [LEAK],
  rules: [
    rule({
      name: 'Water leak',
      key: 'leakDetected',
      limit: 0.5,
      clear: 0.5,
      forS: 10,
      severity: 'high',
    }),
  ],
});

const event = (note: string | null): IncidentEvent => ({
  id: 'event-1',
  kind: 'reported',
  note,
  at: RECEIVED,
  actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
});

/** A critical incident the motor rule raised, with the API's own evidence text. */
function incident(overrides: Partial<IncidentDetail> = {}): IncidentDetail {
  return {
    id: 'incident-1',
    code: 'INC-000107',
    type: 'equipment_fault',
    severity: 'critical',
    status: 'open',
    title: 'Motor over-temperature — Cooling tower 1',
    description: null,
    zoneId: 'zone-dc',
    position: [108.44, 11.95],
    source: 'telemetry',
    assetId: COOLING_TOWER.id,
    reportedAt: RECEIVED,
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    timeline: [event('motorTempC 92 > 85 for 60 s')],
    ...overrides,
  };
}

const leakIncident = (): IncidentDetail =>
  incident({
    severity: 'high',
    title: 'Water leak — Leak sensor, level 3',
    assetId: LEAK_SENSOR.id,
    timeline: [event('leakDetected 1 > 0.5 for 10 s')],
  });

const entry = (values: AssetTelemetryState['values']): AssetTelemetryState => ({
  online: true,
  receivedAt: RECEIVED,
  headline: values,
  values,
  keyReceivedAt: {},
});

/** The API's clock `afterMs` after the reading was received; the age of the reading, to the ms. */
const clockAfter = (afterMs: number) => ({ at: RECEIVED_MS + afterMs, mono: performance.now() });

/** The motor's last minutes, rising through the limit. */
const motorSeries = (afterMs: number): SeriesView => ({
  t: Float64Array.of(RECEIVED_MS + afterMs - 120_000, RECEIVED_MS + afterMs - 60_000),
  v: Float32Array.of(78, 88),
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
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/**
 * The catalogue and the asset's detail are cached, so the first render is the loaded block. The tower's model
 * is cached too: `model` is another tree, `null` for a file with no class root, `false` for nothing (the file
 * is on its way).
 */
function renderBlock(
  detail: IncidentDetail,
  {
    catalogue = [COOLING_TOWER, LEAK_SENSOR],
    details = [COOLING_TOWER, LEAK_SENSOR],
    model = TOWER_TREE,
    zones = [ZONE],
  }: {
    catalogue?: AssetDetail[];
    details?: AssetDetail[];
    model?: NodeInfo | null | false;
    /** `null`: not cached, so the block asks the API for the zones. */
    zones?: Zone[] | null;
  } = {},
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, catalogue);
  if (model !== false) client.setQueryData(queryKeys.model(TOWER_URL), model);
  // The link names the place: cached, so it asks for nothing of its own.
  if (zones) client.setQueryData(queryKeys.zones, zones);
  for (const cached of details) client.setQueryData(queryKeys.asset(cached.code), cached);
  return renderWithQueryClient(<IncidentEvidence incident={detail} />, client);
}

/** The block's one reading row, found from its label. */
const readingRow = (label: string): HTMLElement => {
  const row = screen.getByText(label).closest('div');
  if (!row) throw new Error(`no reading row for ${label}`);
  return row as HTMLElement;
};

describe('IncidentEvidence', () => {
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

  describe('live', () => {
    beforeEach(() =>
      hold({
        assets: { 'CT-01': entry({ motorTempC: 92 }) },
        afterMs: 400,
        series: new Map([[seriesKey('CT-01', 'motorTempC'), motorSeries(400)]]),
      }),
    );

    it('names the rule, the limit with its clear level and the live value', () => {
      renderBlock(incident());

      expect(screen.getByRole('heading', { name: 'Why it was raised' })).toBeInTheDocument();
      expect(screen.getByText('Motor over-temperature')).toBeInTheDocument();
      expect(screen.getByText('above 85 °C for 60 s')).toBeInTheDocument();
      expect(screen.getByText('Motor temperature')).toBeInTheDocument();
      expect(screen.getByText('Limit 85 °C · clears below 80 °C')).toBeInTheDocument();
      expect(screen.getByText('92 °C')).toBeInTheDocument();
      expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('draws the series with the limit line, tinted in the rule severity', () => {
      renderBlock(incident());

      const spark = readingRow('Motor temperature').querySelector('svg');
      expect(spark).toHaveAttribute('data-severity', 'critical');
      expect(spark).not.toHaveAttribute('data-stale');
      expect(spark?.querySelector('line')).not.toBeNull();
      expect(spark?.querySelector('polyline')).not.toBeNull();
    });

    it('says in words that the value is over its limit, and follows the next reading', () => {
      renderBlock(incident());
      expect(screen.getByText(', over its limit')).toBeInTheDocument();

      hold({ assets: { 'CT-01': entry({ motorTempC: 71 }) }, afterMs: 800 });

      expect(screen.getByText('71 °C')).toBeInTheDocument();
      expect(screen.queryByText(', over its limit')).toBeNull();
      expect(readingRow('Motor temperature').querySelector('svg')).not.toHaveAttribute(
        'data-severity',
      );
    });

    it('is the same block with the freshness outside any live region', () => {
      renderBlock(incident());

      expect(screen.getByText('Live').closest('[role="status"], [aria-live]')).toBeNull();
    });

    it('has no accessibility violation', async () => {
      renderBlock(incident());

      await expectNoAxeViolations();
    });
  });

  describe('stale', () => {
    beforeEach(() =>
      hold({
        assets: { 'CT-01': entry({ motorTempC: 92 }) },
        afterMs: 72_000,
        series: new Map([[seriesKey('CT-01', 'motorTempC'), motorSeries(72_000)]]),
      }),
    );

    it('says Stale, dims the row and shows the age of the value', () => {
      renderBlock(incident());

      expect(screen.getByText('Stale')).toBeInTheDocument();
      expect(screen.queryByText('Live')).toBeNull();
      expect(screen.getByText('1 min 12 s old')).toBeInTheDocument();
      const spark = readingRow('Motor temperature').querySelector('svg');
      expect(spark).toHaveAttribute('data-stale');
      expect(readingRow('Motor temperature')).toHaveAttribute('data-stale', 'true');
    });

    it('treats a device that went offline as stale at once', () => {
      hold({ assets: { 'CT-01': { ...entry({ motorTempC: 92 }), online: false } }, afterMs: 400 });

      renderBlock(incident());

      expect(screen.getByText('Stale')).toBeInTheDocument();
    });
  });

  describe('no reading yet', () => {
    it('shows a dash with no chart and no freshness chip', () => {
      hold({ assets: {}, afterMs: 400 });

      renderBlock(incident());

      expect(screen.getByText('Motor over-temperature')).toBeInTheDocument();
      expect(screen.getByText('Limit 85 °C · clears below 80 °C')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(readingRow('Motor temperature').querySelector('svg')).toBeNull();
      expect(screen.queryByText('Live')).toBeNull();
      expect(screen.queryByText('Stale')).toBeNull();
    });
  });

  describe('resolved', () => {
    it('shows what was raised, with no live value, chart or freshness', () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 71 }) }, afterMs: 400 });

      renderBlock(incident({ status: 'resolved', resolvedAt: RECEIVED }));

      expect(screen.getByText('Raised at 92 °C')).toBeInTheDocument();
      expect(screen.getByText('Motor over-temperature')).toBeInTheDocument();
      expect(screen.getByText('Limit 85 °C · clears below 80 °C')).toBeInTheDocument();
      expect(screen.queryByText('71 °C')).toBeNull();
      expect(screen.queryByText('Live')).toBeNull();
      expect(screen.queryByText('Stale')).toBeNull();
      expect(readingRow('Motor temperature').querySelector('svg')).toBeNull();
    });

    it('keeps an acknowledged incident live', () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });

      renderBlock(incident({ status: 'acknowledged', acknowledgedAt: RECEIVED }));

      expect(screen.getByText('Live')).toBeInTheDocument();
    });
  });

  describe('asset gone', () => {
    it('describes the evidence alone when the catalogue has no such asset', () => {
      renderBlock(incident(), { catalogue: [], details: [] });

      expect(screen.getByRole('heading', { name: 'Why it was raised' })).toBeInTheDocument();
      expect(screen.getByText('above 85 for 60 s')).toBeInTheDocument();
      expect(screen.getByText('Raised at 92')).toBeInTheDocument();
      expect(screen.queryByText('Motor over-temperature')).toBeNull();
      expect(screen.queryByText(/clears below/)).toBeNull();
      expect(screen.queryByText('Rule details could not be loaded.')).toBeNull();
    });

    it('does the same when the asset answers 404', async () => {
      fetchMock.mockResolvedValue(json({ statusCode: 404, message: 'Not found' }, 404));

      renderBlock(incident(), { details: [] });

      expect(await screen.findByText('Raised at 92')).toBeInTheDocument();
      expect(screen.queryByText(/clears below/)).toBeNull();
      expect(screen.queryByText('Rule details could not be loaded.')).toBeNull();
    });

    it('says the rules could not be loaded when the asset fails for another reason', async () => {
      fetchMock.mockResolvedValue(json({ statusCode: 500, message: 'Boom' }, 500));

      renderBlock(incident(), { details: [] });

      expect(await screen.findByText('Rule details could not be loaded.')).toBeInTheDocument();
      expect(screen.getByText('Raised at 92')).toBeInTheDocument();
    });
  });

  describe('not evidence', () => {
    it.each([
      ['a person’s note', 'Technician on the way'],
      ['no note', null],
      ['a note with a suffix', 'motorTempC 92 > 85 for 60 s on CT-01'],
    ])('draws nothing and asks for nothing for %s', (_name, note) => {
      const { container } = renderBlock(incident({ timeline: [event(note)] }));

      expect(container).toBeEmptyDOMElement();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('draws nothing for an incident with no timeline', () => {
      const { container } = renderBlock(incident({ timeline: [] }));

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('loading', () => {
    it('shows a skeleton and says so while the catalogue loads', () => {
      renderWithQueryClient(<IncidentEvidence incident={incident()} />);

      expect(screen.getByRole('status')).toHaveTextContent('Loading evidence…');
    });

    it('shows a skeleton while the asset loads', () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.assets, [COOLING_TOWER]);
      renderWithQueryClient(<IncidentEvidence incident={incident()} />, client);

      expect(screen.getByRole('status')).toHaveTextContent('Loading evidence…');
    });
  });

  describe('a rule that cannot be matched', () => {
    it('keeps the limit from the evidence and the incident severity, with no name or clear level', () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });
      // The rule was edited after the incident: its limit is now 90.
      const edited = asset({ rules: [rule({ limit: 90, clear: 85 })] });

      renderBlock(incident({ severity: 'high' }), { details: [edited] });

      expect(screen.getByText('above 85 °C for 60 s')).toBeInTheDocument();
      expect(screen.queryByText('Motor over-temperature')).toBeNull();
      expect(screen.queryByText(/clears below/)).toBeNull();
      const spark = readingRow('Motor temperature').querySelector('svg');
      expect(spark).toHaveAttribute('data-severity', 'high');
      expect(spark?.querySelector('line')).not.toBeNull();
    });
  });

  describe('a boolean point', () => {
    it('says Wet in words, with no limit line on the chart', () => {
      hold({ assets: { 'LKS-B3': entry({ leakDetected: true }) }, afterMs: 400 });

      renderBlock(leakIncident());

      expect(screen.getByText('Water leak')).toBeInTheDocument();
      expect(screen.getByText('Wet for 10 s')).toBeInTheDocument();
      expect(screen.getByText('Wet')).toBeInTheDocument();
      expect(screen.queryByText(/^Limit/)).toBeNull();
      const spark = readingRow('Leak').querySelector('svg');
      expect(spark).toHaveAttribute('data-severity', 'high');
      expect(spark?.querySelector('line')).toBeNull();
    });
  });

  describe('a point the asset does not have', () => {
    it('falls back to what the evidence recorded', () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });

      renderBlock(incident(), { details: [asset({ points: [], headline: [] })] });

      expect(screen.getByText('Raised at 92')).toBeInTheDocument();
      expect(screen.queryByText('Live')).toBeNull();
    });
  });

  describe('the link to the asset', () => {
    const OPEN_CT = { name: 'Open asset CT-01' };

    // V2-15.2: opening the asset also says which building to focus, for the 3D view.
    it('opens the asset and focuses the building it is in', async () => {
      renderBlock(incident());

      await userEvent.click(screen.getByRole('button', OPEN_CT));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(useConsole.getState().focusZoneId).toBe('zone-dc');
    });

    it('opens the asset with no building in focus while the zones are not known', async () => {
      renderBlock(incident(), { zones: null });

      await userEvent.click(screen.getByRole('button', OPEN_CT));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(useConsole.getState().focusZoneId).toBeNull();
    });

    it('names the asset, its part and where it stands, with a way to open it', () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });

      renderBlock(incident());

      expect(screen.getByText('CT-01 · Cooling tower 1')).toBeInTheDocument();
      expect(screen.getByText('Part: fan motor · Data Center · roof')).toBeInTheDocument();
      const open = screen.getByRole('button', OPEN_CT);
      expect(open).toHaveTextContent('Open asset');
    });

    it('names the place alone for a class with no model, asking for no file', () => {
      hold({ assets: { 'LKS-B3': entry({ leakDetected: true }) }, afterMs: 400 });

      renderBlock(leakIncident());

      expect(screen.getByText('LKS-B3 · Leak sensor, level 3')).toBeInTheDocument();
      expect(screen.getByText('Data Center · level 3')).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('writes a part the model gives no label as its node name in sentence case', () => {
      const unlabelled: NodeInfo = {
        name: 'CoolingTower',
        children: [{ name: 'MotorHousing', extras: { bind: 'motorTempC', motion: 'tint' } }],
      };

      renderBlock(incident(), { model: unlabelled });

      expect(screen.getByText('Part: motor housing · Data Center · roof')).toBeInTheDocument();
    });

    it.each([
      [
        'no part bound to the rule’s point',
        { name: 'CoolingTower', children: [{ name: 'Casing' }] },
      ],
      ['no class root', null],
    ] as const)('names the place alone for a model with %s', (_what, model) => {
      renderBlock(incident(), { model });

      expect(screen.getByText('CT-01 · Cooling tower 1')).toBeInTheDocument();
      expect(screen.getByText('Data Center · roof')).toBeInTheDocument();
      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
    });

    it('names the place alone while the model is on its way, the way to the asset in place', () => {
      renderBlock(incident(), { model: false });

      expect(screen.getByText('Data Center · roof')).toBeInTheDocument();
      expect(screen.queryByText(/^Part:/)).toBeNull();
      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(TOWER_URL, { headers: { Range: 'bytes=0-65535' } });
    });

    it('names the place alone when the model cannot be read', async () => {
      fetchMock.mockImplementation(async () =>
        json({ statusCode: 404, message: 'Not found' }, 404),
      );

      const { client } = renderBlock(incident(), { model: false });

      // `useModelParts` retries once, a second later.
      await waitFor(
        () => expect(client.getQueryState(queryKeys.model(TOWER_URL))?.status).toBe('error'),
        {
          timeout: 4000,
        },
      );
      expect(screen.getByText('Data Center · roof')).toBeInTheDocument();
      expect(screen.queryByText(/^Part:/)).toBeNull();
      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
    });

    it('opens the inspector of that asset in place of the incident', async () => {
      useConsole.setState({ selectedIncidentId: 'incident-1' });
      renderBlock(incident());

      await userEvent.click(screen.getByRole('button', OPEN_CT));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(useConsole.getState().selectedIncidentId).toBeNull();
    });

    it('is the same for a viewer, who only reads', async () => {
      useSession.getState().signedIn({ displayName: 'A viewer', roles: ['viewer'] });
      renderBlock(incident());

      await userEvent.click(screen.getByRole('button', OPEN_CT));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
    });

    it.each([
      ['stale', 72_000, true],
      ['not yet read', 400, false],
    ] as const)('stays while the reading is %s', (_name, afterMs, received) => {
      hold({ assets: received ? { 'CT-01': entry({ motorTempC: 92 }) } : {}, afterMs });

      renderBlock(incident());

      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
    });

    it('stays once the incident is resolved', () => {
      renderBlock(incident({ status: 'resolved', resolvedAt: RECEIVED }));

      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
    });

    it('stays when the asset’s rules could not be loaded', async () => {
      fetchMock.mockResolvedValue(json({ statusCode: 500, message: 'Boom' }, 500));

      renderBlock(incident(), { details: [] });

      expect(await screen.findByText('Rule details could not be loaded.')).toBeInTheDocument();
      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
    });

    it('is not drawn for an asset the catalogue does not have', () => {
      renderBlock(incident(), { catalogue: [], details: [] });

      expect(screen.queryByRole('button', { name: /^Open asset/ })).toBeNull();
      expect(screen.queryByText('CT-01 · Cooling tower 1')).toBeNull();
      expect(screen.queryByText('Rule details could not be loaded.')).toBeNull();
    });

    it('is not drawn for an asset the API says is gone', async () => {
      fetchMock.mockResolvedValue(json({ statusCode: 404, message: 'Not found' }, 404));

      renderBlock(incident(), { details: [] });

      expect(await screen.findByText('Raised at 92')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Open asset/ })).toBeNull();
    });

    it('is not drawn while the block loads', () => {
      const client = createTestQueryClient();
      client.setQueryData(queryKeys.assets, [COOLING_TOWER]);
      renderWithQueryClient(<IncidentEvidence incident={incident()} />, client);

      expect(screen.getByRole('status')).toHaveTextContent('Loading evidence…');
      expect(screen.queryByRole('button', { name: /^Open asset/ })).toBeNull();
    });

    it('has no accessibility violation', async () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });
      renderBlock(incident());

      await expectNoAxeViolations();
    });
  });

  // V2-16.6: beside "Open asset", for every role, wherever the twin is available.
  describe('Show in 3D', () => {
    const SHOW_CT = { name: 'Show in 3D CT-01' };
    const OPEN_CT = { name: 'Open asset CT-01' };

    /** A rig that records what it is asked, registered for the case and taken away after it. */
    const rigs: (() => void)[] = [];
    const fakeCommands = () =>
      ({
        flyTo: vi.fn(),
        home: vi.fn(),
        fit: vi.fn(),
        fitAsset: vi.fn(),
        flyToIncident: vi.fn(),
        showAsset: vi.fn(),
        zoomBy: vi.fn(),
        rotateBy: vi.fn(),
        tiltBy: vi.fn(),
        panBy: vi.fn(),
        faceNorth: vi.fn(),
        panStep: vi.fn(),
        panHold: vi.fn(),
        centreOn: vi.fn(),
        current: vi.fn(() => null),
      }) satisfies TwinCommands;
    const fakeRig = () => {
      const rig = fakeCommands();
      rigs.push(registerTwinCommands(rig));
      return rig;
    };

    beforeEach(() => {
      stubTwinAvailable();
      useConsole.setState({ selectedIncidentId: 'incident-1' });
    });

    afterEach(() => {
      rigs.splice(0).forEach((unregister) => unregister());
      // A request nobody took is module state: a throwaway rig takes it.
      registerTwinCommands(fakeCommands())();
      unstubTwin();
      vi.restoreAllMocks();
      try {
        localStorage.removeItem('occ.console.view');
      } catch {
        // No storage: nothing was remembered.
      }
    });

    it.each(['operator', 'supervisor', 'technician', 'viewer'] as const)(
      'is beside "Open asset" for a %s',
      (role) => {
        useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });

        renderBlock(incident());

        expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
        expect(screen.getByRole('button', SHOW_CT)).toBeInTheDocument();
      },
    );

    it('carries the F hint while single-key shortcuts are on, which names the key and not the button', () => {
      renderBlock(incident());

      const show = screen.getByRole('button', SHOW_CT);
      expect(show).toHaveAttribute('aria-keyshortcuts', 'F');
      expect(within(show).getByText('F', { selector: 'kbd' })).toBeInTheDocument();
      expect(screen.getByRole('button', OPEN_CT)).not.toHaveAttribute('aria-keyshortcuts');
    });

    it('has no hint while single-key shortcuts are off', () => {
      useConsole.setState({ keyboardShortcuts: false });

      renderBlock(incident());

      expect(screen.getByRole('button', SHOW_CT)).not.toHaveAttribute('aria-keyshortcuts');
    });

    it('says which asset in its name, and "Show in 3D" in its words (WCAG 2.5.3)', () => {
      renderBlock(incident());

      const show = screen.getByRole('button', SHOW_CT);
      expect(show).toHaveTextContent('Show in 3D');
      // The `F` hint is a `Kbd` hidden from assistive technology: the visible label to match is the words before it.
      const hint = within(show).getByText('F', { selector: 'kbd' }).textContent!;
      const label = show.textContent!.replace(hint, '');
      expect(label).toBe('Show in 3D');
      expect(show.getAttribute('aria-label')).toContain(label);
    });

    it('is not drawn on an incident that is not raised by telemetry', () => {
      renderBlock(incident({ timeline: [] }));

      expect(screen.queryByRole('button', { name: /^Show in 3D/ })).toBeNull();
    });

    it('is not drawn where the twin is unavailable, while "Open asset" stays', () => {
      unstubTwin();

      renderBlock(incident());

      expect(screen.queryByRole('button', { name: /^Show in 3D/ })).toBeNull();
      expect(screen.getByRole('button', OPEN_CT)).toBeInTheDocument();
    });

    it('from the 3D view only asks the camera to frame the asset, and selects nothing', async () => {
      useConsole.setState({ view: '3d' });
      const rig = fakeRig();
      renderBlock(incident());

      await userEvent.click(screen.getByRole('button', SHOW_CT));

      expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
      expect(useConsole.getState()).toMatchObject({
        view: '3d',
        selectedIncidentId: 'incident-1',
        selectedAssetCode: null,
        focusZoneId: null,
      });
    });

    it('from the 2D map switches to 3D, and the flight waits for the stage', async () => {
      useConsole.setState({ view: '2d' });
      renderBlock(incident());

      await userEvent.click(screen.getByRole('button', SHOW_CT));

      expect(useConsole.getState()).toMatchObject({
        view: '3d',
        selectedIncidentId: 'incident-1',
        selectedAssetCode: null,
      });
      // The stage mounts later and its rig registers: the request is waiting for it.
      const rig = fakeRig();
      expect(rig.showAsset).toHaveBeenCalledExactlyOnceWith('CT-01');
    });

    it('asks for no flight when the switch to 3D is refused', async () => {
      useConsole.setState({ view: '2d' });
      renderBlock(incident());
      // The twin stopped working after the button was drawn: `setView` does nothing.
      unstubTwin();

      await userEvent.click(screen.getByRole('button', SHOW_CT));

      expect(useConsole.getState().view).toBe('2d');
      const rig = fakeRig();
      expect(rig.showAsset).not.toHaveBeenCalled();
    });

    it('leaves "Open asset" as it was', async () => {
      renderBlock(incident());

      await userEvent.click(screen.getByRole('button', OPEN_CT));

      expect(useConsole.getState().selectedAssetCode).toBe('CT-01');
      expect(useConsole.getState().focusZoneId).toBe('zone-dc');
    });

    it('has no accessibility violation with both buttons', async () => {
      hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });
      renderBlock(incident());

      expect(screen.getByRole('button', SHOW_CT)).toBeInTheDocument();
      await expectNoAxeViolations();
    });
  });

  it('keeps the block to its own section', () => {
    hold({ assets: { 'CT-01': entry({ motorTempC: 92 }) }, afterMs: 400 });

    renderBlock(incident());

    const section = screen.getByRole('region', { name: 'Why it was raised' });
    expect(within(section).getByText('92 °C')).toBeInTheDocument();
  });
});
