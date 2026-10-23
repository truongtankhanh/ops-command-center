import type { Asset, Incident, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import { act, renderHook } from '@testing-library/react';
import { api } from '../api/client';
import { queryKeys } from '../api/queries';
import { initialTelemetryState } from '../lib/telemetry/telemetryState';
import { heatColor, heatT } from '../lib/twinHeat';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { twinColors } from '../styles/tokens';
import { createTestQueryClient, queryWrapper, resetStore } from '../test-utils';
import { useHeatScene } from './useHeatScene';
import type { TwinScene } from './useTwinScene';

const point = (key: string): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 60,
  headline: 1,
});

const asset = (code: string, zoneId: string, indoor: boolean): Asset => ({
  id: `asset-${code}`,
  code,
  name: code,
  class: {
    id: 'class-x',
    code: 'x',
    name: 'X',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId,
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point(indoor ? 'indoorTempC' : 'loadPct')],
});

const zone = (id: string, name: string, kind: Zone['kind'] = 'building'): Zone => ({
  id,
  code: id.toUpperCase(),
  name,
  kind,
  polygon: [],
  center: [108.44, 11.95],
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
  assetId: 'asset-UPS-01',
  reportedAt: '2026-10-20T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const ZONES = [zone('zone-dc', 'Data Center'), zone('zone-hub', 'Innovation Hub')];
const ASSETS = [
  asset('ICS-DC', 'zone-dc', true),
  asset('ICS-HUB', 'zone-hub', true),
  asset('UPS-01', 'zone-dc', false),
];
/** Only `zones` is read: the hook asks the queries for the rest. */
const SCENE = { zones: ZONES } as unknown as TwinScene;

/** What the console holds of an asset: received `ageMs` ago on the server's clock, which is the test's. */
const entry = (ageMs: number, values: Record<string, TelemetryValue> = {}) => ({
  online: true,
  receivedAt: new Date(Date.now() - ageMs).toISOString(),
  headline: values,
  values,
  keyReceivedAt: {},
});

type Overview = Record<string, ReturnType<typeof entry>>;

/** Both sensors reporting, the data center at 22 °C and the hub at 26.4 °C. */
const reporting = (): Overview => ({
  'ICS-DC': entry(1_000, { indoorTempC: 22 }),
  'ICS-HUB': entry(1_000, { indoorTempC: 26.4 }),
});

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

/** The hook with the catalogue and the incidents in the cache; `null` leaves the catalogue on its way. */
function renderScene({
  assets = ASSETS,
  incidents = [],
}: { assets?: Asset[] | null; incidents?: Incident[] } = {}) {
  const client = createTestQueryClient();
  if (assets) client.setQueryData(queryKeys.assets, assets);
  client.setQueryData(queryKeys.incidents, incidents);
  let renders = 0;
  const rendered = renderHook(
    () => {
      renders += 1;
      return useHeatScene(SCENE);
    },
    { wrapper: queryWrapper(client) },
  );
  return { ...rendered, client, renders: () => renders };
}

const heatOn = () => act(() => useConsole.getState().toggleLayer('heat'));

describe('useHeatScene (V2-17.3)', () => {
  beforeEach(() => {
    resetStore(useConsole);
    setOverview(reporting());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => resetStore(useTelemetryStore));
  });

  describe('when it is shown', () => {
    it('is null while the layer is off, which is how it starts', () => {
      const { result } = renderScene();

      expect(result.current).toBeNull();
    });

    it('is the scene at campus level once the layer is on: a colour and a label per building', () => {
      heatOn();

      const { result } = renderScene();

      expect(result.current?.colours.get('zone-dc')).toBe(heatColor(heatT(22), twinColors.heat));
      expect(result.current?.colours.get('zone-hub')).toBe(heatColor(heatT(26.4), twinColors.heat));
      expect(result.current?.labels.get('zone-dc')).toBe('22.0 °C');
      expect(result.current?.silentNames).toEqual([]);
    });

    it('is still the scene with a building in focus', () => {
      heatOn();
      act(() => useConsole.getState().focusBuilding('zone-dc'));

      const { result } = renderScene();

      expect(result.current).not.toBeNull();
    });

    it('is null with an asset isolated, or one of its parts: the layer stays on and draws nothing different', () => {
      heatOn();
      const { result } = renderScene();
      expect(result.current).not.toBeNull();

      act(() => useConsole.getState().selectAsset('UPS-01', 'zone-dc'));
      expect(result.current).toBeNull();

      act(() => useConsole.getState().selectPart('Door'));
      expect(result.current).toBeNull();
    });

    it('comes back with the colours when the isolation ends', () => {
      heatOn();
      const { result } = renderScene();
      act(() => useConsole.getState().selectAsset('UPS-01', 'zone-dc'));

      act(() => useConsole.getState().focusBuilding('zone-dc'));

      expect(result.current?.colours.size).toBe(2);
    });

    it('goes when the layer is turned off', () => {
      heatOn();
      const { result } = renderScene();

      heatOn();

      expect(result.current).toBeNull();
    });
  });

  describe('what it holds', () => {
    it('makes a building whose sensor is stale silent: faded, "No data", and named', () => {
      heatOn();
      setOverview({ ...reporting(), 'ICS-HUB': entry(200_000, { indoorTempC: 26.4 }) });

      const { result } = renderScene();

      expect([...(result.current?.silent ?? [])]).toEqual(['zone-hub']);
      expect(result.current?.colours.has('zone-hub')).toBe(false);
      expect(result.current?.labels.get('zone-hub')).toBe('No data');
      expect(result.current?.silentNames).toEqual(['Innovation Hub']);
    });

    it('lists the assets with an open incident of their own as alarmed', () => {
      heatOn();

      const { result } = renderScene({ incidents: [incident()] });

      expect([...(result.current?.alarmed ?? [])]).toEqual(['UPS-01']);
    });

    it('follows a reading as it changes', () => {
      heatOn();
      const { result } = renderScene();
      const before = result.current;

      setOverview({ ...reporting(), 'ICS-DC': entry(1_000, { indoorTempC: 25 }) });

      expect(result.current).not.toBe(before);
      expect(result.current?.colours.get('zone-dc')).toBe(heatColor(heatT(25), twinColors.heat));
      expect(result.current?.labels.get('zone-dc')).toBe('25.0 °C');
    });

    it('turns a building silent when its sensor goes quiet, and back when it reports', () => {
      heatOn();
      const { result } = renderScene();

      setOverview({ ...reporting(), 'ICS-DC': entry(200_000, { indoorTempC: 22 }) });
      expect([...(result.current?.silent ?? [])]).toEqual(['zone-dc']);

      setOverview(reporting());
      expect(result.current?.silent.size).toBe(0);
    });
  });

  describe('one object while nothing changes', () => {
    it('keeps the same scene when the readings arrive again with the same values', () => {
      heatOn();
      const { result } = renderScene();
      const before = result.current;

      // A new overview object a second later, every value and every colour the same.
      setOverview(reporting());
      setOverview(reporting());

      expect(result.current).toBe(before);
    });

    it('keeps the same scene when a change is below what is drawn', () => {
      heatOn();
      const { result } = renderScene();
      const before = result.current;

      // Same temperature, a fresher stamp: nothing a reader draws.
      setOverview({
        'ICS-DC': entry(100, { indoorTempC: 22 }),
        'ICS-HUB': entry(100, { indoorTempC: 26.4 }),
      });

      expect(result.current).toBe(before);
    });
  });

  describe('what it asks for', () => {
    it('says nothing while the catalogue is on its way: no building is "silent" for that', () => {
      vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
      heatOn();

      const { result } = renderScene({ assets: null });

      expect(result.current).toBeNull();
    });

    it('does not follow the overview, nor render for it, while the layer is off', () => {
      const { result, renders } = renderScene();
      const before = renders();

      setOverview({ ...reporting(), 'ICS-DC': entry(1_000, { indoorTempC: 25 }) });
      setOverview(reporting());

      expect(renders()).toBe(before);
      expect(result.current).toBeNull();
    });

    it('does not follow the overview while an asset is isolated either', () => {
      heatOn();
      act(() => useConsole.getState().selectAsset('UPS-01', 'zone-dc'));
      const { renders } = renderScene();
      const before = renders();

      setOverview({ ...reporting(), 'ICS-DC': entry(1_000, { indoorTempC: 25 }) });

      expect(renders()).toBe(before);
    });
  });

  it('is null without a scene', () => {
    heatOn();
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.assets, ASSETS);
    client.setQueryData(queryKeys.incidents, []);

    const { result } = renderHook(() => useHeatScene(null), { wrapper: queryWrapper(client) });

    expect(result.current).toBeNull();
  });
});
