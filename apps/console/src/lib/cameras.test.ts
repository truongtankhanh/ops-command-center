import type { Camera } from '@occ/contracts';
import {
  canPin,
  feedState,
  formatCameraTime,
  prioritise,
  readPinnedCameras,
  stripCameras,
  togglePinned,
  writePinnedCameras,
} from '../lib/cameras';

const cam = (code: string, zoneId: string, online = true): Camera => ({
  id: code,
  code,
  name: code,
  zoneId,
  position: [0, 0],
  online,
  fieldOfView: null,
});

describe('prioritise', () => {
  it('puts online cameras of the selected zone first and offline cameras last', () => {
    const cameras = [cam('A', 'z1'), cam('B', 'z2', false), cam('C', 'z2'), cam('D', 'z1', false)];

    expect(prioritise(cameras, 'z2').map((c) => c.code)).toEqual(['C', 'A', 'B', 'D']);
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
    expect(codes(stripCameras(cameras, 'z2', []))).toEqual(
      codes(prioritise(cameras, 'z2').slice(0, 4)),
    );
  });

  it('puts pinned cameras first, in pin order, before the zone', () => {
    expect(codes(stripCameras(cameras, 'z2', ['F', 'B']))).toEqual(['F', 'B', 'C', 'A']);
  });

  it('skips a pin whose camera is gone, so it takes no slot', () => {
    expect(codes(stripCameras(cameras, 'z2', ['gone', 'F']))).toEqual(['F', 'C', 'A', 'E']);
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
