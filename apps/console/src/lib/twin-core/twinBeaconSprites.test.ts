import type { Beacon } from './twinBeacons';
import {
  BASE_CELL,
  beaconCells,
  beaconForm,
  beaconPlacements,
  beaconRadius,
  beaconTargets,
  type CellSpec,
  DISC_CENTRE_PX,
  paintRank,
  PILL,
  PULSE_RING,
  pulseRunning,
} from './twinBeaconSprites';
import { packCells } from './twinAtlas';
import type { AtlasLayout } from './twinMarkers';

const RATIO = 2;
const PILL_WIDTH = 60;

const beacon = (over: Partial<Beacon> = {}): Beacon => ({
  id: 'id-1',
  code: 'INC-000001',
  position: [10, 0, -20],
  severity: 'high',
  type: 'fire_alarm',
  form: 'filled',
  big: false,
  pulse: false,
  tag: null,
  selected: false,
  ...over,
});

/** The telemetry incident of frame 04: critical, open, pulsing, tagged, selected or not. */
const TOWER = beacon({
  id: 'id-107',
  code: 'INC-000107',
  severity: 'critical',
  type: 'equipment_fault',
  big: true,
  pulse: true,
  tag: 'CT-01',
});

/** The atlas as `useBeaconAtlas` draws it: every cell at the ratio, a pill as wide as `PILL_WIDTH` CSS px. */
function layoutOf(cells: readonly CellSpec[], ratio = RATIO): AtlasLayout {
  const sizes = cells.map((cell) => ({
    id: cell.id,
    width: (cell.kind === 'pill' ? PILL_WIDTH : cell.width) * ratio,
    height: cell.height * ratio,
  }));
  return packCells({ width: 0, height: 0, cells: [] }, sizes, { maxWidth: 2048 }).layout;
}

const place = (
  beacons: readonly Beacon[],
  options: { animate?: boolean; without?: string[] } = {},
) => {
  const cells = beaconCells(beacons).filter((cell) => !options.without?.includes(cell.id));
  return beaconPlacements(beacons, layoutOf(cells), RATIO, { animate: options.animate ?? true });
};

describe('beaconForm', () => {
  it('draws an open incident filled and an acknowledged one as a ring, as the map does', () => {
    expect(beaconForm(beacon({ form: 'filled' }))).toEqual({
      kind: 'incident',
      severity: 'high',
      status: 'open',
      type: 'fire_alarm',
    });
    expect(beaconForm(beacon({ form: 'hollow', severity: 'low', type: 'crowding' }))).toEqual({
      kind: 'incident',
      severity: 'low',
      status: 'acknowledged',
      type: 'crowding',
    });
  });

  it('draws a resolved incident neutral, whatever its severity', () => {
    expect(beaconForm(beacon({ form: 'resolved', severity: 'critical' }))).toEqual({
      kind: 'resolved',
      type: 'fire_alarm',
    });
  });

  it('keeps a type this console does not know as the generic one', () => {
    expect(beaconForm(beacon({ type: 'unknown' })).type).toBe('unknown');
  });
});

describe('beaconCells', () => {
  it('needs nothing for no beacons', () => {
    expect(beaconCells([])).toEqual([]);
  });

  it('needs one base cell for each distinct form, at the base size, once however many beacons share it', () => {
    const cells = beaconCells([
      beacon({ id: 'a' }),
      beacon({ id: 'b' }),
      beacon({ id: 'c', form: 'hollow' }),
      beacon({ id: 'd', severity: 'low' }),
    ]);

    expect(cells.map((cell) => cell.id)).toEqual([
      'beacon:incident-high-open-fire_alarm',
      'beacon:incident-high-acknowledged-fire_alarm',
      'beacon:incident-low-open-fire_alarm',
    ]);
    for (const cell of cells) {
      expect(cell).toMatchObject({
        kind: 'base',
        width: BASE_CELL.width,
        height: BASE_CELL.height,
      });
    }
  });

  it('draws the ellipse and the stem in the severity hue, and neutral for a resolved incident', () => {
    const [active, resolved] = beaconCells([
      beacon({ severity: 'critical' }),
      beacon({ form: 'resolved', severity: 'critical' }),
    ]);

    expect(active).toMatchObject({ kind: 'base', hue: '#ff426d' });
    expect(resolved).toMatchObject({ kind: 'base', hue: '#91a5b4' });
  });

  it('needs a ring only for a selected beacon, one for each disc radius', () => {
    expect(beaconCells([beacon()]).some((cell) => cell.kind === 'ring')).toBe(false);

    const rings = beaconCells([
      beacon({ id: 'a', selected: true }),
      beacon({ id: 'b', selected: true, severity: 'medium' }),
      beacon({ id: 'c', selected: true, severity: 'low' }),
      beacon({ id: 'd', selected: true, severity: 'critical' }),
    ]).filter((cell) => cell.kind === 'ring');

    // The disc steps 10, 10, 11, 12: three radii, and the ring is 5 px outside the disc plus its stroke.
    expect(rings.map((cell) => cell.id)).toEqual([
      'beacon-ring:11',
      'beacon-ring:10',
      'beacon-ring:12',
    ]);
    expect(rings.map((cell) => cell.width)).toEqual([39, 37, 41]);
    for (const ring of rings) expect(ring.width).toBe(ring.height);
  });

  it('needs the pulse ring once, only for a beacon that pulses', () => {
    expect(beaconCells([beacon()]).some((cell) => cell.kind === 'pulse')).toBe(false);

    const pulses = beaconCells([TOWER, { ...TOWER, id: 'other', code: 'INC-2', tag: null }]).filter(
      (cell) => cell.kind === 'pulse',
    );

    expect(pulses).toHaveLength(1);
    expect(pulses[0]).toMatchObject({
      width: PULSE_RING.box,
      height: PULSE_RING.box,
      hue: '#ff426d',
    });
  });

  it('needs a pill for each distinct tag, as high as the pill is', () => {
    const pills = beaconCells([
      TOWER,
      { ...TOWER, id: 'again' },
      { ...TOWER, id: 'two', tag: 'CT-02' },
    ]).filter((cell) => cell.kind === 'pill');

    expect(pills).toEqual([
      { kind: 'pill', id: 'beacon-tag:CT-01', height: PILL.height, text: 'CT-01' },
      { kind: 'pill', id: 'beacon-tag:CT-02', height: PILL.height, text: 'CT-02' },
    ]);
  });
});

describe('beaconPlacements', () => {
  it('stands a base sprite on the beacon’s ground point with no offset and no phase', () => {
    const placements = place([beacon()]);

    expect(placements).toEqual([
      {
        id: 'id-1:base',
        position: [10, 0, -20],
        image: 'beacon:incident-high-open-fire_alarm',
      },
    ]);
  });

  it('has nothing to draw for no beacons', () => {
    expect(place([])).toEqual([]);
  });

  it('puts the selection ring round the disc: its centre at the disc’s centre, 28 px above the foot', () => {
    const placements = place([beacon({ selected: true })]);

    expect(placements.map(({ id }) => id)).toEqual(['id-1:ring', 'id-1:base']);
    // A high incident's ring is 39 px high, so its bottom is 28 − 19.5 above the foot.
    expect(placements[0]).toMatchObject({
      image: 'beacon-ring:11',
      offset: [0, DISC_CENTRE_PX - 19.5],
    });
    expect(placements[0]?.phase).toBeUndefined();
  });

  it('puts the pulse ring round the disc, under the base, starting at phase zero', () => {
    const placements = place([TOWER]);

    expect(placements.map(({ id }) => id)).toEqual(['id-107:pulse', 'id-107:base', 'id-107:tag']);
    expect(placements[0]).toMatchObject({
      image: 'beacon-pulse',
      offset: [0, DISC_CENTRE_PX - PULSE_RING.box / 2],
      phase: 0,
    });
  });

  it('places no pulse ring when motion is not allowed, and keeps everything else', () => {
    const placements = place([TOWER], { animate: false });

    expect(placements.map(({ id }) => id)).toEqual(['id-107:base', 'id-107:tag']);
  });

  it('puts the tag pill beside the disc: a gap from its edge, centred on it', () => {
    const [, , pill] = place([TOWER]);

    // The critical disc is 12 px in radius; the pill is 60 px wide, so its centre is 12 + 8 + 30 to the right.
    expect(pill).toMatchObject({
      image: 'beacon-tag:CT-01',
      offset: [12 + PILL.gap + PILL_WIDTH / 2, DISC_CENTRE_PX - PILL.height / 2],
    });
    expect(pill?.phase).toBeUndefined();
  });

  it('paints a ring under its disc and a pill over it, selected pulsing beacon included', () => {
    const placements = place([{ ...TOWER, selected: true }]);

    expect(placements.map(({ id }) => id)).toEqual([
      'id-107:pulse',
      'id-107:ring',
      'id-107:base',
      'id-107:tag',
    ]);
  });

  it('paints the lowest priority first: resolved, then by severity, open above acknowledged, selected last', () => {
    const beacons = [
      beacon({ id: 'critical-open', code: 'A', severity: 'critical' }),
      beacon({ id: 'low-ack', code: 'B', severity: 'low', form: 'hollow' }),
      beacon({ id: 'resolved', code: 'C', form: 'resolved', severity: 'critical' }),
      beacon({ id: 'medium-open', code: 'D', severity: 'medium' }),
      beacon({ id: 'medium-ack', code: 'E', severity: 'medium', form: 'hollow' }),
      beacon({ id: 'selected-low', code: 'F', severity: 'low', selected: true }),
      beacon({ id: 'high-open', code: 'G', severity: 'high' }),
    ];

    const bases = place(beacons)
      .filter(({ id }) => id.endsWith(':base'))
      .map(({ id }) => id.replace(':base', ''));

    expect(bases).toEqual([
      'resolved',
      'low-ack',
      'medium-ack',
      'medium-open',
      'high-open',
      'critical-open',
      'selected-low',
    ]);
  });

  it('keeps the data’s order between beacons of the same priority', () => {
    const bases = place([
      beacon({ id: 'x', code: 'INC-1' }),
      beacon({ id: 'y', code: 'INC-2' }),
      beacon({ id: 'z', code: 'INC-3' }),
    ]).map(({ id }) => id);

    expect(bases).toEqual(['x:base', 'y:base', 'z:base']);
  });

  it('leaves a beacon out whole while its base cell is not in the atlas', () => {
    const missing = 'beacon:incident-high-open-fire_alarm';

    const placements = place([beacon({ selected: true }), TOWER], { without: [missing] });

    expect(placements.map(({ id }) => id)).toEqual(['id-107:pulse', 'id-107:base', 'id-107:tag']);
  });

  it('leaves out an overlay whose cell is not in the atlas yet and keeps the base: a pill waits for its font', () => {
    const placements = place([TOWER], { without: ['beacon-tag:CT-01'] });

    expect(placements.map(({ id }) => id)).toEqual(['id-107:pulse', 'id-107:base']);
  });

  it('reads sizes in CSS pixels from the layout and the ratio, not from the CSS constants', () => {
    // The same atlas drawn at ratio 1 and 3: the offsets are in CSS pixels either way.
    const beacons = [beacon({ selected: true })];
    const at = (ratio: number) =>
      beaconPlacements(beacons, layoutOf(beaconCells(beacons), ratio), ratio, { animate: true });

    expect(at(1)).toEqual(at(3));
  });

  it('puts every sprite of a beacon at the same ground point', () => {
    const placements = place([{ ...TOWER, selected: true, position: [3, 19, -4] }]);

    expect(placements).toHaveLength(4);
    for (const { position } of placements) expect(position).toEqual([3, 19, -4]);
  });

  it('changes nothing in its arguments', () => {
    const beacons = [TOWER, beacon({ id: 'b', selected: true })];
    const layout = layoutOf(beaconCells(beacons));
    const before = structuredClone({ beacons, layout });

    beaconPlacements(beacons, layout, RATIO, { animate: true });

    expect({ beacons, layout }).toEqual(before);
  });
});

describe('pulseRunning', () => {
  const pulsing = [{ pulse: true }];
  const base = { shown: true, animate: true, hidden: false, beacons: pulsing };

  it('runs while the layer is shown, motion is allowed, the tab is in view and a beacon pulses', () => {
    expect(pulseRunning(base)).toBe(true);
  });

  it.each([
    ['the Incidents layer is off', { shown: false }],
    ['the user asks for reduced motion', { animate: false }],
    ['the tab is hidden', { hidden: true }],
    ['no beacon pulses', { beacons: [{ pulse: false }, { pulse: false }] }],
    ['there is no beacon', { beacons: [] }],
  ])('does not run when %s', (_, change) => {
    expect(pulseRunning({ ...base, ...change })).toBe(false);
  });

  it('runs when only one of several beacons pulses', () => {
    expect(pulseRunning({ ...base, beacons: [{ pulse: false }, { pulse: true }] })).toBe(true);
  });
});

describe('paintRank', () => {
  const rank = (over: Partial<Beacon>) => paintRank(beacon(over));

  it('orders resolved, then low to critical, an open one above an acknowledged one of its severity', () => {
    const order = [
      rank({ form: 'resolved' }),
      rank({ severity: 'low', form: 'hollow' }),
      rank({ severity: 'low', form: 'filled' }),
      rank({ severity: 'medium', form: 'hollow' }),
      rank({ severity: 'medium', form: 'filled' }),
      rank({ severity: 'high', form: 'hollow' }),
      rank({ severity: 'high', form: 'filled' }),
      rank({ severity: 'critical', form: 'hollow' }),
      rank({ severity: 'critical', form: 'filled' }),
    ];

    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it('puts the selected beacon above every other, whatever its severity', () => {
    expect(rank({ severity: 'low', form: 'resolved', selected: true })).toBeGreaterThan(
      rank({ severity: 'critical', form: 'filled' }),
    );
  });

  it('is the order the beacons are painted in', () => {
    const beacons = [
      beacon({ id: 'critical', severity: 'critical' }),
      beacon({ id: 'low', severity: 'low', selected: true }),
      beacon({ id: 'medium', severity: 'medium' }),
    ];

    const painted = place(beacons)
      .filter(({ id }) => id.endsWith(':base'))
      .map(({ id }) => id.replace(':base', ''));

    expect(painted).toEqual(
      [...beacons].sort((a, b) => paintRank(a) - paintRank(b)).map(({ id }) => id),
    );
  });
});

describe('beaconRadius', () => {
  it('is the map’s step by severity, and the neutral 10 for a resolved beacon', () => {
    expect(beaconRadius(beacon({ severity: 'low' }))).toBe(10);
    expect(beaconRadius(beacon({ severity: 'medium' }))).toBe(10);
    expect(beaconRadius(beacon({ severity: 'high' }))).toBe(11);
    expect(beaconRadius(beacon({ severity: 'critical' }))).toBe(12);
    expect(beaconRadius(beacon({ severity: 'critical', form: 'resolved' }))).toBe(10);
  });
});

describe('beaconTargets', () => {
  it('is a target for each beacon whose base sprite is drawn, with its radius and rank', () => {
    const beacons = [TOWER, beacon({ id: 'b', severity: 'low', form: 'hollow' })];

    const targets = beaconTargets(beacons, place(beacons));

    expect(targets).toEqual([
      { id: 'id-107', position: TOWER.position, radius: 12, rank: paintRank(TOWER) },
      { id: 'b', position: [10, 0, -20], radius: 10, rank: paintRank(beacons[1]!) },
    ]);
  });

  it('leaves out a beacon whose base is not drawn yet', () => {
    const beacons = [TOWER, beacon()];
    const placements = place(beacons, { without: ['beacon:incident-high-open-fire_alarm'] });

    expect(beaconTargets(beacons, placements).map(({ id }) => id)).toEqual(['id-107']);
  });

  it('does not take an overlay for a beacon: a ring or a pill alone is no target', () => {
    const overlays = place([beacon({ selected: true })]).filter(({ id }) => !id.endsWith(':base'));

    expect(beaconTargets([beacon({ selected: true })], overlays)).toEqual([]);
  });

  it('ranks the selected beacon above the others', () => {
    const beacons = [
      beacon({ id: 'a', severity: 'critical' }),
      beacon({ id: 'b', selected: true }),
    ];

    const [a, b] = beaconTargets(beacons, place(beacons));

    expect(b!.rank).toBeGreaterThan(a!.rank);
  });

  it('is empty for no beacons and for nothing drawn', () => {
    expect(beaconTargets([], [])).toEqual([]);
    expect(beaconTargets([TOWER], [])).toEqual([]);
  });
});
