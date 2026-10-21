import type { Camera, Incident, LngLat } from '@occ/contracts';
import {
  cameraLink,
  canPin,
  feedState,
  formatCameraTime,
  incidentCameras,
  PIN_LIMIT,
  prioritise,
  readPinnedCameras,
  type StripSubject,
  stripCameras,
  stripSize,
  stripSubject,
  togglePinned,
  wallStripSize,
  wallSubject,
  writePinnedCameras,
} from '../lib/cameras';
import { offsetM } from '../lib/geo';

const cam = (code: string, zoneId: string, online = true): Camera => ({
  id: code,
  code,
  name: code,
  zoneId,
  position: [0, 0],
  online,
  fieldOfView: null,
});

const zone = (zoneId: string): StripSubject => ({ kind: 'zone', zoneId });

describe('prioritise', () => {
  it('puts online cameras of the selected zone first and offline cameras last', () => {
    const cameras = [cam('A', 'z1'), cam('B', 'z2', false), cam('C', 'z2'), cam('D', 'z1', false)];

    expect(prioritise(cameras, zone('z2')).map((c) => c.code)).toEqual(['C', 'A', 'B', 'D']);
  });
});

describe('stripCameras', () => {
  const cameras = [
    cam('A', 'z1'),
    cam('B', 'z2', false),
    cam('C', 'z2'),
    cam('D', 'z1', false),
    cam('E', 'z3'),
    cam('F', 'z3'),
  ];
  const codes = (list: Camera[]) => list.map((c) => c.code);

  it('fills the strip in prioritise order when nothing is pinned', () => {
    expect(codes(stripCameras(cameras, zone('z2'), [], 4))).toEqual(
      codes(prioritise(cameras, zone('z2')).slice(0, 4)),
    );
  });

  it('puts pinned cameras first, in pin order, before the zone', () => {
    expect(codes(stripCameras(cameras, zone('z2'), ['F', 'B'], 4))).toEqual(['F', 'B', 'C', 'A']);
  });

  it('skips a pin whose camera is gone, so it takes no slot', () => {
    expect(codes(stripCameras(cameras, zone('z2'), ['gone', 'F'], 4))).toEqual([
      'F',
      'C',
      'A',
      'E',
    ]);
  });

  it('fills a larger strip with the pins first, then the prioritised rest', () => {
    expect(codes(stripCameras(cameras, zone('z2'), ['F', 'B'], 6))).toEqual([
      'F',
      'B',
      'C',
      'A',
      'E',
      'D',
    ]);
  });
});

describe('with an asset selected', () => {
  /** The selected asset, in zone `z1`. */
  const ASSET: LngLat = [108.44, 11.95];
  const subject: StripSubject = { kind: 'asset', position: ASSET, zoneId: 'z1' };

  /** 20 m south of the asset and facing north: the asset is in its 90°, 50 m sector. */
  const seeing = (code: string, zoneId: string, online = true): Camera => ({
    ...cam(code, zoneId, online),
    position: offsetM(ASSET, 0, -20),
    fieldOfView: { heading: 0, angle: 90, range: 50 },
  });
  const codes = (list: Camera[]) => list.map((c) => c.code);

  const cameras = [
    cam('A', 'z1'),
    seeing('B', 'z2'),
    cam('C', 'z2'),
    seeing('D', 'z2', false),
    cam('E', 'z1', false),
  ];

  it('puts the cameras that see it first, then its zone, then the rest', () => {
    expect(codes(prioritise(cameras, subject).slice(0, 3))).toEqual(['B', 'A', 'C']);
  });

  it('puts every offline camera after every online one, in the same tiers', () => {
    expect(codes(prioritise(cameras, subject))).toEqual(['B', 'A', 'C', 'D', 'E']);
  });

  it('keeps the pins first, in pin order', () => {
    expect(codes(stripCameras(cameras, subject, ['C', 'E'], 4))).toEqual(['C', 'E', 'B', 'A']);
  });

  it('orders by code within a tier, so the strip does not reshuffle', () => {
    const tied = [seeing('Z', 'z2'), seeing('M', 'z2'), seeing('A', 'z3')];

    expect(codes(prioritise(tied, subject))).toEqual(['A', 'M', 'Z']);
  });

  it('falls back to the zone for a camera without a field of view', () => {
    expect(codes(prioritise([cam('Q', 'z2'), cam('P', 'z1')], subject))).toEqual(['P', 'Q']);
  });

  it('is the incident order, unchanged, for a zone subject', () => {
    // The cameras that would see an asset count for nothing when only a zone is selected.
    expect(codes(prioritise(cameras, zone('z1')))).toEqual(['A', 'B', 'C', 'E', 'D']);
  });

  it('is the old order with nothing selected: online by code, then offline by code', () => {
    expect(codes(prioritise(cameras, undefined))).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('cameraLink', () => {
  const ASSET: LngLat = [108.44, 11.95];
  const subject: StripSubject = { kind: 'asset', position: ASSET, zoneId: 'z1' };
  const seeing = (zoneId: string): Camera => ({
    ...cam('S', zoneId),
    position: offsetM(ASSET, 0, -20),
    fieldOfView: { heading: 0, angle: 90, range: 50 },
  });

  it('says a camera that sees the asset is on it, whichever zone it is in', () => {
    expect(cameraLink(seeing('z2'), subject)).toBe('asset');
    expect(cameraLink(seeing('z1'), subject)).toBe('asset');
  });

  it('says a camera in the asset’s zone that does not see it is in the zone', () => {
    const away = { ...seeing('z1'), fieldOfView: { heading: 180, angle: 90, range: 50 } };

    expect(cameraLink(away, subject)).toBe('zone');
  });

  it('says nothing of a camera in another zone that does not see it', () => {
    expect(cameraLink(cam('X', 'z2'), subject)).toBeNull();
  });

  it('counts the zone only for a zone subject', () => {
    expect(cameraLink(seeing('z2'), zone('z2'))).toBe('zone');
    expect(cameraLink(seeing('z2'), zone('z1'))).toBeNull();
  });

  it('says nothing with no subject', () => {
    expect(cameraLink(seeing('z1'), undefined)).toBeNull();
  });

  it('falls back to the zone for a camera from an API without a field of view', () => {
    const old = { ...cam('O', 'z1') } as Partial<Camera>;
    delete old.fieldOfView;

    expect(cameraLink(old as Camera, subject)).toBe('zone');
  });
});

describe('stripSubject', () => {
  const asset = { position: [108.44, 11.95] as LngLat, zoneId: 'z1' };

  it('is the incident’s zone when an incident is selected', () => {
    expect(stripSubject('z2', undefined)).toEqual({ kind: 'zone', zoneId: 'z2' });
  });

  it('keeps the incident when an asset is somehow selected too', () => {
    expect(stripSubject('z2', asset)).toEqual({ kind: 'zone', zoneId: 'z2' });
  });

  it('is the asset, with its position and zone, when only an asset is selected', () => {
    expect(stripSubject(undefined, asset)).toEqual({
      kind: 'asset',
      position: asset.position,
      zoneId: 'z1',
    });
  });

  it('is nothing when nothing is selected', () => {
    expect(stripSubject(undefined, undefined)).toBeUndefined();
  });
});

describe('incidentCameras', () => {
  const ASSET: LngLat = [108.44, 11.95];
  const asset = { position: ASSET };
  const incident = { zoneId: 'z1' };
  const codes = (list: { cameras: Camera[] }) => list.cameras.map((c) => c.code);

  /** 20 m south of the asset and facing north: the asset is in its 90°, 50 m sector. */
  const seeing = (code: string, zoneId: string, online = true): Camera => ({
    ...cam(code, zoneId, online),
    position: offsetM(ASSET, 0, -20),
    fieldOfView: { heading: 0, angle: 90, range: 50 },
  });

  it('is the incident zone’s first two cameras, in list order, with no asset', () => {
    const cameras = [cam('C', 'z1'), cam('A', 'z2'), cam('B', 'z1'), cam('D', 'z1')];

    const picked = incidentCameras(cameras, incident, undefined);

    expect(codes(picked)).toEqual(['C', 'B']);
    expect(picked.onAsset).toBe(false);
  });

  it('puts the cameras that see the asset first, then its zone’s, two in all', () => {
    const cameras = [cam('A', 'z1'), cam('B', 'z1'), seeing('S', 'z2')];

    const picked = incidentCameras(cameras, incident, asset);

    expect(codes(picked)).toEqual(['S', 'A']);
    expect(picked.onAsset).toBe(true);
  });

  it('shows a camera of another zone when it sees the asset', () => {
    const picked = incidentCameras([seeing('S', 'z9')], incident, asset);

    expect(codes(picked)).toEqual(['S']);
    expect(picked.onAsset).toBe(true);
  });

  it('is the zone’s cameras, as with no asset, when none sees it', () => {
    const cameras = [cam('C', 'z1'), cam('A', 'z2'), cam('B', 'z1')];

    const picked = incidentCameras(cameras, incident, asset);

    expect(codes(picked)).toEqual(['C', 'B']);
    expect(picked.onAsset).toBe(false);
  });

  it('never shows a camera of another zone that does not see the asset', () => {
    const picked = incidentCameras([cam('A', 'z2'), cam('B', 'z3')], incident, asset);

    expect(picked.cameras).toEqual([]);
    expect(picked.onAsset).toBe(false);
  });

  it('does not say "on the asset" when online zone cameras push the covering one out', () => {
    // The camera that sees it is offline, so it comes after two online cameras of the zone.
    const cameras = [cam('A', 'z1'), cam('B', 'z1'), seeing('S', 'z2', false)];

    const picked = incidentCameras(cameras, incident, asset);

    expect(codes(picked)).toEqual(['A', 'B']);
    expect(picked.onAsset).toBe(false);
  });

  it('says "on the asset" when an offline camera that sees it still fits', () => {
    const picked = incidentCameras([cam('A', 'z1'), seeing('S', 'z2', false)], incident, asset);

    expect(codes(picked)).toEqual(['A', 'S']);
    expect(picked.onAsset).toBe(true);
  });

  it('treats a camera without a field of view as the zone’s', () => {
    const picked = incidentCameras([cam('Q', 'z1')], incident, asset);

    expect(codes(picked)).toEqual(['Q']);
    expect(picked.onAsset).toBe(false);
  });

  it('takes as many cameras as asked', () => {
    const cameras = [seeing('A', 'z1'), seeing('B', 'z1'), seeing('C', 'z1')];

    expect(incidentCameras(cameras, incident, asset, 3).cameras).toHaveLength(3);
    expect(incidentCameras(cameras, incident, asset, 1).cameras).toHaveLength(1);
  });

  it('leaves its input alone', () => {
    const cameras = [cam('B', 'z1'), seeing('A', 'z2')];

    incidentCameras(cameras, incident, asset);

    expect(codes({ cameras })).toEqual(['B', 'A']);
  });
});

describe('stripSize', () => {
  it.each([
    ['wall-4k', 8],
    ['wall', 6],
    ['laptop', 4],
    ['tablet', 4],
    ['phone', 4],
  ] as const)('a %s display holds %i tiles', (mode, tiles) => {
    expect(stripSize(mode)).toBe(tiles);
  });

  it('never holds fewer tiles than can be pinned, so a pin keeps its slot in every mode', () => {
    for (const mode of ['wall-4k', 'wall', 'laptop', 'tablet', 'phone'] as const) {
      expect(stripSize(mode)).toBeGreaterThanOrEqual(PIN_LIMIT);
    }
  });
});

describe('togglePinned', () => {
  const known = ['A', 'B', 'C', 'D', 'E', 'F'];

  it('pins a camera', () => {
    expect(togglePinned([], 'A', known)).toEqual(['A']);
  });

  it('unpins a pinned camera', () => {
    expect(togglePinned(['A', 'B'], 'A', known)).toEqual(['B']);
  });

  it('leaves a full strip as it is', () => {
    expect(togglePinned(['A', 'B', 'C', 'D'], 'E', known)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('drops pins of cameras that are gone, which frees their slot', () => {
    expect(togglePinned(['gone', 'A', 'B', 'C'], 'D', known)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('canPin', () => {
  const known = ['A', 'B', 'C', 'D', 'E'];

  it('lets a pinned camera be unpinned from a full strip', () => {
    expect(canPin(['A', 'B', 'C', 'D'], 'A', known)).toBe(true);
  });

  it('pins while the strip has room', () => {
    expect(canPin(['A'], 'B', known)).toBe(true);
  });

  it('pins nothing more once four cameras are pinned', () => {
    expect(canPin(['A', 'B', 'C', 'D'], 'E', known)).toBe(false);
  });

  it('does not count a pin whose camera is gone', () => {
    expect(canPin(['gone', 'A', 'B', 'C'], 'E', known)).toBe(true);
  });
});

describe('feedState', () => {
  it.each([
    ['offline, whatever the stream says', false, { isError: true, data: {} }, 'offline'],
    ['unavailable when the stream request failed', true, { isError: true }, 'unavailable'],
    ['a stream once its descriptor arrived', true, { isError: false, data: {} }, 'stream'],
    ['pending while the descriptor is on its way', true, { isError: false }, 'pending'],
    // A retry clears the error of a request that never had data; the frame stays unavailable.
    [
      'still unavailable while a failed request is retried',
      true,
      { isError: false, errorUpdatedAt: 1 },
      'unavailable',
    ],
  ] as const)('is %s', (_name, online, query, expected) => {
    expect(feedState(online, query)).toBe(expected);
  });
});

describe('formatCameraTime', () => {
  const at = (hours: number, minutes: number, seconds: number) =>
    new Date(2026, 9, 8, hours, minutes, seconds).getTime();

  it('shows hours, minutes and seconds on a 24-hour clock', () => {
    expect(formatCameraTime(at(15, 4, 5))).toBe('15:04:05');
  });

  it('keeps the leading zero in the morning', () => {
    expect(formatCameraTime(at(7, 8, 9))).toBe('07:08:09');
  });

  it('starts the day at 00, not 24', () => {
    expect(formatCameraTime(at(0, 5, 9))).toBe('00:05:09');
  });
});

describe('pinned camera storage', () => {
  const KEY = 'occ.console.pinnedCameras';

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reads back what it wrote', () => {
    writePinnedCameras(['a', 'b']);

    expect(readPinnedCameras()).toEqual(['a', 'b']);
  });

  it('reads no pins when nothing is stored', () => {
    expect(readPinnedCameras()).toEqual([]);
  });

  it.each([
    ['broken JSON', '{'],
    ['an object', '{"a":1}'],
    ['an array holding a non-string', '["a",2]'],
  ])('reads no pins from %s', (_name, stored) => {
    localStorage.setItem(KEY, stored);

    expect(readPinnedCameras()).toEqual([]);
  });

  it('reads no pins when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readPinnedCameras()).toEqual([]);
  });

  it('keeps going when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(() => writePinnedCameras(['a'])).not.toThrow();
  });
});

describe('wallSubject', () => {
  const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
    id,
    code: id.toUpperCase(),
    type: 'fire_alarm',
    severity: 'medium',
    status: 'open',
    title: id,
    description: null,
    zoneId: `zone-${id}`,
    position: [0, 0],
    source: 'operator',
    reportedAt: '2026-10-08T08:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  });

  it('follows the incident the wall holds in focus, whatever else is open', () => {
    const incidents = [incident('a', { severity: 'critical' }), incident('b', { severity: 'low' })];

    const followed = wallSubject(incidents, 'b');

    expect(followed?.incident.id).toBe('b');
    expect(followed?.subject).toEqual({ kind: 'zone', zoneId: 'zone-b' });
  });

  it('follows the incident the feed puts first when none is in focus: the most severe, then the newest', () => {
    const incidents = [
      incident('low', { severity: 'low' }),
      incident('high-old', { severity: 'high', reportedAt: '2026-10-08T07:00:00.000Z' }),
      incident('high-new', { severity: 'high', reportedAt: '2026-10-08T09:00:00.000Z' }),
    ];

    expect(wallSubject(incidents, null)?.incident.id).toBe('high-new');
  });

  it('counts an acknowledged incident, but never a resolved one', () => {
    const incidents = [
      incident('done', { severity: 'critical', status: 'resolved' }),
      incident('handled', { severity: 'low', status: 'acknowledged' }),
    ];

    expect(wallSubject(incidents, null)?.incident.id).toBe('handled');
  });

  it('falls back to the feed when the focused incident is no longer in the list', () => {
    const incidents = [incident('a', { severity: 'high' })];

    expect(wallSubject(incidents, 'gone')?.incident.id).toBe('a');
  });

  it('has no subject when nothing is active', () => {
    expect(wallSubject([], null)).toBeUndefined();
    expect(wallSubject([incident('done', { status: 'resolved' })], null)).toBeUndefined();
  });

  it('does not reorder the list it is given', () => {
    const incidents = [
      incident('low', { severity: 'low' }),
      incident('high', { severity: 'high' }),
    ];

    wallSubject(incidents, null);

    expect(incidents.map((i) => i.id)).toEqual(['low', 'high']);
  });
});

describe('wallStripSize', () => {
  it('is six on a wall of any size, and the strip’s four elsewhere', () => {
    expect(wallStripSize('wall')).toBe(6);
    expect(wallStripSize('wall-4k')).toBe(6);
    expect(wallStripSize('laptop')).toBe(PIN_LIMIT);
    expect(wallStripSize('tablet')).toBe(PIN_LIMIT);
  });

  it('keeps the active list its room at 4K: the console’s strip has eight tiles there, the wall does not', () => {
    expect(stripSize('wall-4k')).toBe(8);
    expect(wallStripSize('wall-4k')).toBeLessThan(stripSize('wall-4k'));
  });
});
