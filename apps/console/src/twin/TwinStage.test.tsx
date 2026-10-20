import type {
  Asset,
  AssetDetail,
  Incident,
  LngLat,
  Role,
  SitePlan,
  TelemetryPoint,
  Zone,
} from '@occ/contracts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { queryKeys } from '../api/queries';
import { useSession } from '../auth/store';
import { initialTelemetryState } from '../lib/telemetryState';
import type { Binding } from '../lib/twinBindings';
import { MAX_ZONE_LABELS } from '../lib/twinScene';
import type { TelemetryClient } from '../realtime/telemetryClient';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { createTestQueryClient, renderWithQueryClient, resetStore } from '../test-utils';
import { TwinCanvas } from './TwinCanvas';
import TwinStage from './TwinStage';

// R3F's canvas needs WebGL, which jsdom does not have; the stage's job here is to mount it, and to hand it
// the scene (a spy, so a test can read what the stage derived).
vi.mock('./TwinCanvas', () => ({ TwinCanvas: vi.fn(() => <canvas aria-label="3D canvas" />) }));

const CENTER: LngLat = [108.4415, 11.953];

/** A square of about 90 m around a point `index` squares east of the centre. */
function zone(index: number, kind: Zone['kind'], name: string): Zone {
  const [lng, lat] = [CENTER[0] + index * 0.001, CENTER[1]];
  const half = 0.0004;
  return {
    id: `zone-${index}`,
    code: `Z-${index}`,
    name,
    kind,
    ...(kind === 'building' ? { heightM: 18 } : {}),
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

const PLAN: SitePlan = {
  id: 'plan-1',
  code: 'LANGBIANG',
  name: 'Langbiang Tech Campus',
  center: CENTER,
  features: [],
};

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** An asset of a 2 × 1 × 3 m class, at `position`, in `zoneId`, as the catalogue serves it. */
const asset = (code: string, zoneId: string, position: LngLat, elevationM = 0): Asset => ({
  id: code,
  code,
  name: code,
  class: {
    id: 'ups',
    code: 'ups',
    name: 'UPS',
    modelUrl: null,
    footprintM: { width: 2, depth: 1, height: 3 },
  },
  zoneId,
  position,
  elevationM,
  headingDeg: 0,
  headline: [],
});

/** An asset of a class that has a model, as the catalogue serves it. */
const modelled = (
  code: string,
  zoneId: string,
  position: LngLat,
  classCode = 'cooling_tower',
): Asset => {
  const base = asset(code, zoneId, position);
  return {
    ...base,
    class: {
      ...base.class,
      id: classCode,
      code: classCode,
      name: classCode === 'cooling_tower' ? 'Cooling tower' : classCode,
      modelUrl: `/models/${classCode}.0123456789ab.glb`,
    },
  };
};

/** The stage with the site's reference data already in the cache, as it is once the map has loaded. */
function renderStage(
  zones: Zone[],
  incidents: Incident[] = [],
  assets: Asset[] = [],
  seed?: (client: ReturnType<typeof createTestQueryClient>) => void,
) {
  const client = createTestQueryClient();
  client.setQueryData(queryKeys.zones, zones);
  client.setQueryData(queryKeys.sitePlan, PLAN);
  // The stage reads the cameras, the incidents and the assets too; an unseeded query would try to fetch them.
  client.setQueryData(queryKeys.cameras, []);
  client.setQueryData(queryKeys.incidents, incidents);
  client.setQueryData(queryKeys.assets, assets);
  seed?.(client);
  return renderWithQueryClient(<TwinStage />, client);
}

/** The group that stands for the picture (`TwinView`); the camera controls are another group. */
const view = () => screen.getByRole('group', { name: /^3D view of/ });

describe('TwinStage', () => {
  it('mounts the canvas', () => {
    renderStage([]);

    expect(screen.getByLabelText('3D canvas')).toBeInTheDocument();
  });

  it('labels every zone with its name', () => {
    renderStage([
      zone(0, 'building', 'Library'),
      zone(1, 'outdoor', 'Central Lawn'),
      zone(2, 'parking', 'West Parking'),
    ]);

    for (const name of ['Library', 'Central Lawn', 'West Parking']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('puts the buildings first, then the other zones in order', () => {
    renderStage([
      zone(0, 'outdoor', 'Central Lawn'),
      zone(1, 'building', 'Library'),
      zone(2, 'parking', 'West Parking'),
      zone(3, 'building', 'Data Center'),
    ]);

    const layer = screen.getByText('Library').parentElement!;
    expect([...layer.children].map((label) => label.textContent)).toEqual([
      'Library',
      'Data Center',
      'Central Lawn',
      'West Parking',
    ]);
  });

  it('hides the labels from assistive technology, which has the names elsewhere', () => {
    renderStage([zone(0, 'building', 'Library')]);

    expect(screen.getByText('Library').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no more than the cap', () => {
    renderStage(
      Array.from({ length: MAX_ZONE_LABELS + 6 }, (_, i) => zone(i, 'outdoor', `Lawn ${i}`)),
    );

    expect(screen.getAllByText(/^Lawn \d+$/)).toHaveLength(MAX_ZONE_LABELS);
  });

  it('draws the stage chrome over the canvas: the camera controls, the legend and the drag hint', () => {
    renderStage([zone(0, 'building', 'Library')]);

    const camera = screen.getByRole('group', { name: 'Camera' });
    expect(within(camera).getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Face north' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
    expect(screen.getByText(/Drag to rotate/)).toBeInTheDocument();
  });

  // The legend explains what is drawn; frame 06 (loading) has none, and it would sit under the loading card.
  it('draws the camera controls and the hint before the scene has anything to show, but not the legend', () => {
    renderStage([]);

    expect(screen.getByRole('group', { name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByText(/Drag to rotate/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
  });

  // V2-17.4: the heat legend stands over the marker legend in one column, so the two never overlap.
  describe('the legends (V2-17.4)', () => {
    beforeEach(() => resetStore(useConsole));
    afterEach(() => resetStore(useConsole));

    const heatOn = () => act(() => useConsole.getState().toggleLayer('heat'));

    it('draws only the marker legend while Heat is off', () => {
      renderStage([zone(0, 'building', 'Library')]);

      expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('draws the heat legend above the marker legend, in the same column, once Heat is on', () => {
      renderStage([zone(0, 'building', 'Library')]);

      heatOn();

      const heat = screen.getByRole('note');
      const markers = screen.getByRole('button', { name: 'Legend' });
      expect(heat.parentElement).toContainElement(markers);
      expect(heat.compareDocumentPosition(markers)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(heat).toHaveTextContent('Indoor temperature, by building');
    });

    it('keeps the building line that says Esc returns, under the heat legend, at building level', () => {
      renderStage([zone(0, 'building', 'Library')]);
      heatOn();

      act(() => useConsole.getState().focusBuilding('zone-0'));

      expect(screen.getByRole('note')).toBeInTheDocument();
      expect(screen.getByText(/Walls see-through/)).toBeInTheDocument();
    });

    it('takes the heat legend away with an asset isolated, where Heat draws nothing different', () => {
      renderStage([zone(0, 'building', 'Library')]);
      heatOn();

      act(() => useConsole.getState().selectAsset('UPS-01', 'zone-0'));

      expect(screen.queryByRole('note')).toBeNull();
    });

    it('draws neither legend before the scene has anything to show', () => {
      renderStage([]);

      heatOn();

      expect(screen.queryByRole('note')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Legend' })).toBeNull();
    });

    it('puts the heat legend outside the view group and takes no tab stop', () => {
      renderStage([zone(0, 'building', 'Library')]);
      heatOn();

      expect(view()).not.toContainElement(screen.getByRole('note'));
      expect(screen.getByRole('note')).not.toHaveAttribute('tabindex');
    });
  });

  it('has no label without zones', () => {
    renderStage([]);

    expect(screen.queryByText(/./, { selector: 'span' })).not.toBeInTheDocument();
  });

  describe('the equipment (V2-14.6)', () => {
    /** The assets of the scene the canvas was last given. */
    const sceneAssets = () => vi.mocked(TwinCanvas).mock.lastCall?.[0].scene?.assets;

    beforeEach(() => {
      vi.mocked(TwinCanvas).mockClear();
    });

    it('hands the canvas every asset placed and posed, in the catalogue order of codes', () => {
      const zones = [zone(0, 'building', 'Library'), zone(1, 'outdoor', 'Central Lawn')];
      renderStage(
        zones,
        [],
        [
          asset('UPS-OUT', 'zone-1', zones[1]!.center),
          asset('UPS-IN', 'zone-0', zones[0]!.center),
          asset('UPS-ROOF', 'zone-0', zones[0]!.center, 18),
        ],
      );

      expect(sceneAssets()?.map(({ code, placement }) => [code, placement])).toEqual([
        ['UPS-IN', 'inside'],
        ['UPS-OUT', 'outdoor'],
        ['UPS-ROOF', 'roof'],
      ]);
      const roof = sceneAssets()?.find(({ code }) => code === 'UPS-ROOF');
      expect(roof?.pose.y).toBe(18);
      expect(roof?.size).toEqual({ x: 2, y: 3, z: 1 });
    });

    it('hands the canvas none while the catalogue is empty', () => {
      renderStage([zone(0, 'building', 'Library')]);

      expect(sceneAssets()).toEqual([]);
    });
  });

  describe('the models (V2-14.7)', () => {
    const last = () => vi.mocked(TwinCanvas).mock.lastCall?.[0];

    beforeEach(() => {
      vi.mocked(TwinCanvas).mockClear();
    });

    it('hands the canvas the classes that have a model, with how many assets each has, and none for the rest', () => {
      const zones = [zone(0, 'building', 'Library')];
      const here = zones[0]!.center;
      renderStage(
        zones,
        [],
        [
          modelled('CT-02', 'zone-0', here),
          modelled('CT-01', 'zone-0', here),
          asset('UPS-01', 'zone-0', here),
        ],
      );

      expect(
        last()?.scene?.classes.map(({ code, assetCount, representative }) => [
          code,
          assetCount,
          representative,
        ]),
      ).toEqual([['cooling_tower', 2, 'CT-01']]);
      expect(last()?.scene?.assets.map(({ classCode }) => classCode)).toEqual([
        'cooling_tower',
        'cooling_tower',
        'ups',
      ]);
    });

    it('hands the canvas no class when no asset has a model', () => {
      const zones = [zone(0, 'building', 'Library')];
      renderStage(zones, [], [asset('UPS-01', 'zone-0', zones[0]!.center)]);

      expect(last()?.scene?.classes).toEqual([]);
      expect(last()?.classPoints).toEqual({});
    });

    it('hands the canvas the points of a class once its representative’s detail is cached', () => {
      const zones = [zone(0, 'building', 'Library')];
      const points = [{ key: 'fanSpeedRpm', kind: 'number' }] as TelemetryPoint[];
      renderStage(zones, [], [modelled('CT-01', 'zone-0', zones[0]!.center)], (client) =>
        client.setQueryData(queryKeys.asset('CT-01'), { code: 'CT-01', points } as AssetDetail),
      );

      expect(last()?.classPoints).toEqual({ cooling_tower: points });
    });
  });

  describe('the telemetry feed (V2-14.8)', () => {
    const last = () => vi.mocked(TwinCanvas).mock.lastCall?.[0];

    /** A telemetry client with nothing behind it that hands out layout ids. */
    const fakeClient = (): TelemetryClient => ({
      subscribe: () => () => undefined,
      getView: () => ({ state: initialTelemetryState, series: new Map() }),
      setWatch: vi.fn(),
      retry: vi.fn(),
      setLayout: vi.fn(() => 1),
      onTargets: () => () => undefined,
      getTargets: () => null,
      getStats: () => ({ messages: 0, targetPosts: 0 }),
      dispose: vi.fn(),
    });

    let stop: (() => void) | null = null;
    const adopt = () => {
      act(() => {
        stop = useTelemetryStore.getState().adopt(fakeClient());
      });
    };

    beforeEach(() => {
      vi.mocked(TwinCanvas).mockClear();
    });

    afterEach(() => {
      act(() => stop?.());
      stop = null;
    });

    it('hands the canvas no feed while there is no telemetry client', () => {
      renderStage([zone(0, 'building', 'Library')]);

      expect(last()?.feed).toBeNull();
    });

    it('hands the canvas the feed once there is a client', () => {
      adopt();

      renderStage([zone(0, 'building', 'Library')]);

      expect(last()?.feed).not.toBeNull();
    });

    it('wakes the canvas through the invalidate it hands back, and is harmless before it does', () => {
      adopt();
      const zones = [zone(0, 'building', 'Library')];
      const binding: Binding = {
        node: 'FanBlade',
        key: 'fanSpeedRpm',
        motion: 'spin',
        axis: 'y',
        range: [0, 1800],
        point: { kind: 'number', min: 0, max: 1800, enumValues: null },
        parent: null,
      };
      renderStage(zones, [], [modelled('CT-01', 'zone-0', zones[0]!.center)]);
      const feed = last()!.feed!;

      // The canvas has not said it exists yet: a change in the layout asks for a frame nobody can draw.
      expect(() => feed.setBindings('cooling_tower', [binding])).not.toThrow();

      const invalidate = vi.fn();
      last()!.onInvalidate(invalidate);
      feed.setBindings('cooling_tower', [{ ...binding, key: 'motorTempC' }]);

      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe('the incident beacons (V2-16.3)', () => {
    const beacons = () => vi.mocked(TwinCanvas).mock.lastCall?.[0].beacons;

    beforeEach(() => {
      vi.mocked(TwinCanvas).mockClear();
      resetStore(useConsole);
    });
    afterEach(() => resetStore(useConsole));

    /** The Library: a building 18 m tall around the campus's centre. */
    const library = () => zone(0, 'building', 'Library');
    const outside = () => zone(1, 'outdoor', 'Central Lawn');

    it('hands the canvas a beacon for each active incident, in the order of their codes', () => {
      renderStage(
        [library(), outside()],
        [
          incident({
            id: 'b',
            code: 'INC-000002',
            status: 'acknowledged',
            zoneId: 'zone-1',
            position: outside().center,
          }),
          incident({ id: 'a', code: 'INC-000001', zoneId: 'zone-0', position: library().center }),
          incident({
            id: 'r',
            code: 'INC-000003',
            status: 'resolved',
            zoneId: 'zone-1',
            position: outside().center,
          }),
        ],
      );

      expect(beacons()?.map(({ code, form }) => [code, form])).toEqual([
        ['INC-000001', 'filled'],
        ['INC-000002', 'hollow'],
      ]);
    });

    it('stands an incident inside a building on its roof and one outside at the ground', () => {
      renderStage(
        [library(), outside()],
        [
          incident({ id: 'a', code: 'INC-000001', zoneId: 'zone-0', position: library().center }),
          incident({ id: 'b', code: 'INC-000002', zoneId: 'zone-1', position: outside().center }),
        ],
      );

      expect(beacons()?.map(({ position }) => position[1])).toEqual([18, 0]);
    });

    it('hands the canvas a resolved incident only while it is selected', () => {
      const resolved = incident({
        id: 'r',
        code: 'INC-000003',
        status: 'resolved',
        zoneId: 'zone-1',
        position: outside().center,
      });
      const zones = [library(), outside()];

      const { unmount } = renderStage(zones, [resolved]);
      expect(beacons()).toEqual([]);
      unmount();

      useConsole.setState({ selectedIncidentId: 'r' });
      renderStage(zones, [resolved]);
      expect(beacons()?.map(({ code, form, selected }) => [code, form, selected])).toEqual([
        ['INC-000003', 'resolved', true],
      ]);
    });

    it('follows the selection when it changes', () => {
      renderStage(
        [library()],
        [incident({ id: 'a', code: 'INC-000001', zoneId: 'zone-0', position: library().center })],
      );
      expect(beacons()?.[0]?.selected).toBe(false);

      act(() => useConsole.setState({ selectedIncidentId: 'a' }));

      expect(beacons()?.[0]?.selected).toBe(true);
    });

    it('tags the incident of an asset with its code and stands it on the asset’s top', () => {
      const zones = [library()];
      renderStage(
        zones,
        [
          incident({
            id: 'tel',
            code: 'INC-000107',
            severity: 'critical',
            zoneId: 'zone-0',
            position: zones[0]!.center,
            assetId: 'CT-01',
            source: 'telemetry',
          }),
        ],
        // On the roof (18 m) of a 3 m class: the top is 21 m.
        [asset('CT-01', 'zone-0', zones[0]!.center, 18)],
      );

      expect(beacons()?.[0]).toMatchObject({
        code: 'INC-000107',
        tag: 'CT-01',
        big: true,
        pulse: true,
        form: 'filled',
        position: [expect.any(Number), 21, expect.any(Number)],
      });
    });

    it('hands the canvas none while there are no incidents', () => {
      renderStage([library()]);

      expect(beacons()).toEqual([]);
    });
  });

  describe('the zone outline (V2-16.4)', () => {
    const highlight = () => vi.mocked(TwinCanvas).mock.lastCall?.[0].highlightZoneId;
    const library = () => zone(0, 'building', 'Library');
    const outside = () => zone(1, 'outdoor', 'Central Lawn');
    const incidents = () => [
      incident({ id: 'a', code: 'INC-000001', zoneId: 'zone-0', position: library().center }),
      incident({ id: 'b', code: 'INC-000002', zoneId: 'zone-1', position: outside().center }),
    ];

    beforeEach(() => {
      vi.mocked(TwinCanvas).mockClear();
      resetStore(useConsole);
    });
    afterEach(() => resetStore(useConsole));

    it('hands the canvas no zone while nothing is selected', () => {
      renderStage([library(), outside()], incidents());

      expect(highlight()).toBeNull();
    });

    it('hands the canvas the zone of the selected incident, and follows the selection', () => {
      useConsole.setState({ selectedIncidentId: 'a' });
      renderStage([library(), outside()], incidents());
      expect(highlight()).toBe('zone-0');

      act(() => useConsole.getState().select('b'));
      expect(highlight()).toBe('zone-1');

      act(() => useConsole.getState().select(null));
      expect(highlight()).toBeNull();
    });

    it('hands the canvas the report’s zone while the form is open', () => {
      renderStage([library(), outside()], incidents());

      act(() => useConsole.getState().startReport());
      expect(highlight()).toBeNull();

      act(() => useConsole.getState().setReportZone('zone-1'));
      expect(highlight()).toBe('zone-1');

      act(() => useConsole.getState().closeReport());
      expect(highlight()).toBeNull();
    });

    it('prefers the report’s zone to the selected incident’s', () => {
      useConsole.setState({ selectedIncidentId: 'a', reporting: true, reportZoneId: 'zone-1' });
      renderStage([library(), outside()], incidents());

      expect(highlight()).toBe('zone-1');
    });

    it('hands the canvas no zone for an incident the list does not hold', () => {
      useConsole.setState({ selectedIncidentId: 'gone' });
      renderStage([library(), outside()], incidents());

      expect(highlight()).toBeNull();
    });
  });

  describe('for assistive technology', () => {
    afterEach(() => resetStore(useSession));

    it('is one group named by a summary of the site and its active incidents', () => {
      renderStage([zone(0, 'building', 'Library')], [incident({}), incident({ id: 'b' })]);

      expect(view()).toHaveAccessibleName(
        '3D view of Langbiang Tech Campus with 2 active incidents. Drag to rotate. The incident list and the Assets tab list everything shown here.',
      );
      expect(view()).toHaveAttribute('aria-roledescription', '3D view');
    });

    it('holds the canvas, hidden, and the zone labels', () => {
      renderStage([zone(0, 'building', 'Library')]);

      const canvas = screen.getByLabelText('3D canvas');
      expect(view()).toContainElement(canvas);
      expect(canvas.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(view()).not.toHaveAttribute('aria-hidden');
      expect(view()).toContainElement(screen.getByText('Library'));
    });

    it('leaves the camera controls, the legend and the hint outside the group', () => {
      renderStage([zone(0, 'building', 'Library')]);

      expect(view()).not.toContainElement(screen.getByRole('group', { name: 'Camera' }));
      expect(view()).not.toContainElement(screen.getByRole('button', { name: 'Legend' }));
      expect(view()).not.toContainElement(screen.getByText(/Drag to rotate/));
    });

    // One stop for the picture, then the controls' own stops (V2-12.10); Tab then leaves the stage.
    it('takes one tab stop for the view, then the legend and the camera controls, then Tab leaves', async () => {
      const user = userEvent.setup();
      renderStage([zone(0, 'building', 'Library')]);

      await user.tab();
      expect(view()).toHaveFocus();

      for (const name of [
        'Legend',
        'Face north',
        'Zoom in',
        'Zoom out',
        'Rotate left',
        'Rotate right',
        'Reset view',
      ]) {
        await user.tab();
        expect(screen.getByRole('button', { name })).toHaveFocus();
      }

      await user.tab();
      expect(document.body).toHaveFocus();
    });

    // Nothing in the stage reads a session or a permission (the console hides what a role cannot do, and
    // the 3D view does nothing a role cannot): this keeps it so.
    it.each<Role>(['viewer', 'technician', 'operator'])('is the same stage for a %s', (role) => {
      useSession.getState().signedIn({ displayName: 'Someone', roles: [role] });

      renderStage([zone(0, 'building', 'Library')], [incident({})]);

      expect(view()).toHaveAccessibleName(
        /^3D view of Langbiang Tech Campus with 1 active incident\./,
      );
      expect(
        within(screen.getByRole('group', { name: 'Camera' })).getAllByRole('button'),
      ).toHaveLength(5);
      expect(screen.getByRole('button', { name: 'Face north' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Legend' })).toBeInTheDocument();
    });
  });

  describe('the heat overlay (V2-17.3)', () => {
    const heat = () => vi.mocked(TwinCanvas).mock.lastCall?.[0].heat;
    const indoorPoint = {
      key: 'indoorTempC',
      label: 'Indoor temperature',
      unit: '°C',
      kind: 'number',
      min: null,
      max: null,
      enumValues: null,
      expectedIntervalS: 60,
      headline: 1,
    } as TelemetryPoint;
    const sensor = (): Asset => ({
      ...asset('ICS-LIB', 'zone-0', CENTER),
      headline: [indoorPoint],
    });
    const reading = (tempC: number) => ({
      online: true,
      receivedAt: new Date(Date.now() - 1_000).toISOString(),
      headline: { indoorTempC: tempC },
      values: { indoorTempC: tempC },
      keyReceivedAt: {},
    });
    const report = (tempC: number) =>
      act(() => {
        useTelemetryStore.setState({
          view: {
            state: {
              ...initialTelemetryState,
              serverClock: { at: Date.now(), mono: performance.now() },
              assets: { 'ICS-LIB': reading(tempC) },
            },
            series: new Map(),
          },
        });
      });

    beforeEach(() => {
      resetStore(useConsole);
      vi.mocked(TwinCanvas).mockClear();
    });

    afterEach(() => {
      resetStore(useConsole);
      act(() => resetStore(useTelemetryStore));
    });

    it('hands the canvas no overlay while the layer is off, which is how it starts', () => {
      report(22);

      renderStage([zone(0, 'building', 'Library')], [], [sensor()]);

      expect(heat()).toBeNull();
    });

    it('hands it the overlay once the layer is on: a colour for the building that reports', () => {
      report(22);
      act(() => useConsole.getState().toggleLayer('heat'));

      renderStage([zone(0, 'building', 'Library')], [], [sensor()]);

      expect(heat()?.colours.get('zone-0')).toMatch(/^#[0-9a-f]{6}$/);
      expect(heat()?.labels.get('zone-0')).toBe('22.0 °C');
    });

    it('takes the overlay back from the canvas when an asset is isolated', () => {
      report(22);
      act(() => useConsole.getState().toggleLayer('heat'));
      renderStage([zone(0, 'building', 'Library')], [], [sensor()]);
      expect(heat()).not.toBeNull();

      act(() => useConsole.getState().selectAsset('ICS-LIB', 'zone-0'));

      expect(heat()).toBeNull();
    });
  });
});
