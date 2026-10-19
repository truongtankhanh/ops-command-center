import type { Asset, Incident, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { initialTelemetryState } from '../lib/telemetryState';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import {
  createTestQueryClient,
  expectNoAxeViolations,
  renderWithQueryClient,
  resetStore,
} from '../test-utils';
import { BuildingSummary } from './BuildingSummary';

const point = (key: string): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
});

const asset = (code: string, overrides: Partial<Asset> = {}): Asset => ({
  id: `asset-${code}`,
  code,
  name: code,
  class: {
    id: 'class-ups',
    code: 'ups',
    name: 'UPS',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point('loadPct')],
  ...overrides,
});

const zone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  use: 'data_center',
  heightM: 14,
  polygon: [],
  center: [108.44, 11.95],
  ...overrides,
});

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc-1',
  code: 'INC-000105',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Fault',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: null,
  reportedAt: '2026-10-19T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** Eight assets as the seed's Data Center holds them, `ICS-DC` being its one indoor-temperature source. */
const ASSETS = [
  asset('BAT-01'),
  asset('CRAC-01'),
  asset('CRAC-02'),
  asset('CT-01'),
  asset('CT-02'),
  asset('GEN-01'),
  asset('ICS-DC', { headline: [point('indoorTempC')] }),
  asset('UPS-01'),
];

/** What the console holds of an asset: received `ageMs` ago on the server's clock, which is the test's. */
const entry = (ageMs: number, values: Record<string, TelemetryValue> = {}) => ({
  online: true,
  receivedAt: new Date(Date.now() - ageMs).toISOString(),
  headline: values,
  values,
  keyReceivedAt: {},
});

type Overview = Record<string, ReturnType<typeof entry>>;

/** Every asset reporting, and the sensor at 22.1 °C. */
const reporting = (): Overview =>
  Object.fromEntries(
    ASSETS.map(({ code }) => [code, entry(1_000, code === 'ICS-DC' ? { indoorTempC: 22.1 } : {})]),
  );

function setOverview(overview: Overview): void {
  act(() => {
    useTelemetryStore.setState({
      view: {
        state: {
          ...initialTelemetryState,
          serverClock: { at: Date.now(), mono: performance.now() },
          assets: overview,
        },
        series: new Map(),
      },
    });
  });
}

/**
 * The card with the reference data and the incidents in the cache, as they are once the console has loaded;
 * `null` leaves one out, so its query is still on its way.
 */
function renderCard({
  zones = [zone(), zone({ id: 'zone-hub', code: 'BLD-HUB', name: 'Innovation Hub' })],
  assets = ASSETS,
  incidents = [],
  overview = reporting(),
}: {
  zones?: Zone[] | null;
  assets?: Asset[];
  incidents?: Incident[] | null;
  overview?: Overview;
} = {}) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.assets, assets);
  if (zones) client.setQueryData(queryKeys.zones, zones);
  if (incidents) client.setQueryData(queryKeys.incidents, incidents);
  setOverview(overview);
  return renderWithQueryClient(<BuildingSummary />, client);
}

const focusDataCenter = () => act(() => useConsole.getState().focusBuilding('zone-dc'));
const region = () => screen.getByRole('region', { name: 'Data Center summary' });
/** The figure beside a row's name. */
const row = (name: string) => screen.getByText(name, { selector: 'dt' }).nextElementSibling;

describe('BuildingSummary', () => {
  beforeEach(() => resetStore(useConsole));

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => resetStore(useTelemetryStore));
  });

  describe('where it shows', () => {
    it('draws nothing at campus level', () => {
      renderCard();

      expect(screen.queryByRole('region')).toBeNull();
    });

    it('draws nothing at asset level and part level, with the building still in focus', () => {
      focusDataCenter();
      renderCard();
      expect(region()).toBeInTheDocument();

      act(() => useConsole.getState().selectAsset('UPS-01', 'zone-dc'));
      expect(screen.queryByRole('region')).toBeNull();

      act(() => useConsole.getState().selectPart('Door'));
      expect(screen.queryByRole('region')).toBeNull();
    });

    it('comes back at building level, and goes with the focus', () => {
      focusDataCenter();
      renderCard();
      expect(region()).toBeInTheDocument();

      act(() => useConsole.getState().goCampus());

      expect(screen.queryByRole('region')).toBeNull();
    });

    it('draws nothing while the zones are on their way: there is no name to give it', () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      focusDataCenter();

      renderCard({ zones: null });

      expect(screen.queryByRole('region')).toBeNull();
    });

    it('draws nothing for a focus on a zone the console does not hold', () => {
      act(() => useConsole.getState().focusBuilding('zone-gone'));

      renderCard();

      expect(screen.queryByRole('region')).toBeNull();
    });
  });

  describe('what it says', () => {
    it('is a region named after the building, with its kind and name', () => {
      focusDataCenter();
      renderCard();

      expect(region()).toHaveTextContent('Building · data center');
      expect(region()).toHaveTextContent('Data Center');
    });

    it('names another building for another focus', () => {
      act(() => useConsole.getState().focusBuilding('zone-hub'));

      renderCard({ zones: [zone(), zone({ id: 'zone-hub', name: 'Innovation Hub', use: null })] });

      expect(screen.getByRole('region', { name: 'Innovation Hub summary' })).toHaveTextContent(
        'Building',
      );
    });

    it('reads "8 · all reporting" with live data, and "Open incidents 1 · INC-000105", "Indoor 22.1 °C"', () => {
      focusDataCenter();
      renderCard({ incidents: [incident()] });

      expect(row('Assets')).toHaveTextContent('8 · all reporting');
      expect(row('Open incidents')).toHaveTextContent('1 · INC-000105');
      expect(row('Indoor')).toHaveTextContent('22.1 °C');
    });

    it('counts the asset whose reading is stale as without data', () => {
      focusDataCenter();
      renderCard({ overview: { ...reporting(), 'UPS-01': entry(60_000) } });

      expect(row('Assets')).toHaveTextContent('8 · 1 without data');
    });

    it('says "None" when there is no open incident', () => {
      focusDataCenter();
      renderCard({ incidents: [] });

      expect(row('Open incidents')).toHaveTextContent('None');
    });

    it('leaves the incidents row out while the incident list is on its way, instead of "None"', () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      focusDataCenter();

      renderCard({ incidents: null });

      expect(screen.queryByText('Open incidents')).toBeNull();
      expect(row('Assets')).toHaveTextContent('8 · all reporting');
    });

    it('omits the indoor row for a building with no reading of it', () => {
      focusDataCenter();
      renderCard({ assets: ASSETS.filter(({ code }) => code !== 'ICS-DC') });

      expect(screen.queryByText('Indoor')).toBeNull();
    });

    it('omits the indoor row when its only source is stale, and the assets row says so', () => {
      focusDataCenter();
      renderCard({ overview: { ...reporting(), 'ICS-DC': entry(60_000, { indoorTempC: 22.1 }) } });

      expect(screen.queryByText('Indoor')).toBeNull();
      expect(row('Assets')).toHaveTextContent('8 · 1 without data');
    });

    it('has no IT load and no power row: no point is a building`s load', () => {
      focusDataCenter();
      renderCard({ incidents: [incident()] });

      expect(region()).not.toHaveTextContent(/IT load|Power/);
      expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
        'Assets',
        'Open incidents',
        'Indoor',
      ]);
    });

    it('follows the readings as they change', () => {
      focusDataCenter();
      renderCard();
      expect(row('Assets')).toHaveTextContent('8 · all reporting');

      setOverview({
        ...reporting(),
        'UPS-01': entry(60_000),
        'ICS-DC': entry(1_000, { indoorTempC: 23.4 }),
      });

      expect(row('Assets')).toHaveTextContent('8 · 1 without data');
      expect(row('Indoor')).toHaveTextContent('23.4 °C');
    });

    // The query cache tells its observers on a timer, not inside `act`: wait for the output (testing.md).
    it('follows the incidents as they are raised', async () => {
      focusDataCenter();
      const { client } = renderCard();
      expect(row('Open incidents')).toHaveTextContent('None');

      act(() => {
        client.setQueryData(queryKeys.incidents, [incident()]);
      });

      await waitFor(() => expect(row('Open incidents')).toHaveTextContent('1 · INC-000105'));
    });
  });

  // The card reads no session and no permission, so it renders here with neither, and so for every role.
  it('is the same for every role: it reads no permission', () => {
    focusDataCenter();
    renderCard({ incidents: [incident()] });

    expect(row('Assets')).toHaveTextContent('8 · all reporting');
    expect(row('Open incidents')).toHaveTextContent('1 · INC-000105');
  });

  // The figures change every second and a new incident is announced by the feed and the toasts.
  it('is not a live region', () => {
    focusDataCenter();
    const { container } = renderCard({ incidents: [incident()] });

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    focusDataCenter();
    renderCard({ incidents: [incident()] });

    await expectNoAxeViolations();
  });
});
