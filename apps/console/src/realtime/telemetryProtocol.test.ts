import {
  type FromWorker,
  isFromWorker,
  isToWorker,
  TELEMETRY_PROTOCOL_VERSION,
  type ToWorker,
} from './telemetryProtocol';

const v = TELEMETRY_PROTOCOL_VERSION;

const toWorker: ToWorker[] = [
  { v, type: 'connect' },
  { v, type: 'token', requestId: 7, token: 'a.b.c' },
  { v, type: 'token', requestId: 8, token: null },
  { v, type: 'watch', assets: ['CT-01', 'CT-02'] },
  { v, type: 'watch', assets: [], enums: { 'BAR-01': { armPosition: ['up', 'down', 'moving'] } } },
  {
    v,
    type: 'seed',
    assetCode: 'CT-01',
    series: [
      { key: 'fanSpeedRpm', t: new Float64Array([1_000, 6_000]), v: new Float32Array([1, 2]) },
    ],
  },
  { v, type: 'retry' },
  { v, type: 'dispose' },
];

const fromWorker: FromWorker[] = [
  { v, type: 'tokenRequest', requestId: 7, renew: false },
  { v, type: 'tokenRequest', requestId: 8, renew: true },
  {
    v,
    type: 'state',
    upstream: 'live',
    upstreamSince: '2026-10-15T08:00:00.000Z',
    socket: 'live',
    socketSince: null,
    serverNowMs: Date.parse('2026-10-15T08:00:01.000Z'),
    assets: {
      'CT-01': {
        online: true,
        receivedAt: '2026-10-15T08:00:00.000Z',
        headline: { fanSpeedRpm: 1420 },
        values: { fanSpeedRpm: 1420, running: true },
        keyReceivedAt: {
          fanSpeedRpm: '2026-10-15T08:00:00.000Z',
          running: '2026-10-15T08:00:00.000Z',
        },
      },
    },
  },
  {
    v,
    type: 'series',
    entries: [
      {
        assetCode: 'CT-01',
        key: 'fanSpeedRpm',
        t: new Float64Array([1_000, 2_000, 3_000]),
        v: new Float32Array([1, 2, 3]),
      },
    ],
  },
  { v, type: 'targets', buffer: new Float32Array([0.5, 1.5]) },
];

/**
 * `structuredClone` is Node's, so a cloned typed array is of another realm than the test's
 * `Float64Array`: neither `instanceof` nor `toEqual` accepts it. This reads typed arrays as their
 * kind and contents (`ArrayBuffer.isView` works across realms), and everything else as it is.
 */
const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      ArrayBuffer.isView(item)
        ? {
            kind: Object.prototype.toString.call(item),
            values: Array.from(item as unknown as ArrayLike<number>),
          }
        : item,
    ),
  );

describe('the protocol', () => {
  it.each(toWorker.map((message) => [message.type, message] as const))(
    'main → worker "%s" survives a structured clone and passes its guard',
    (_type, message) => {
      const received: unknown = structuredClone(message);

      expect(isToWorker(received)).toBe(true);
      expect(plain(received)).toEqual(plain(message));
    },
  );

  it.each(fromWorker.map((message) => [message.type, message] as const))(
    'worker → main "%s" survives a structured clone and passes its guard',
    (_type, message) => {
      const received: unknown = structuredClone(message);

      expect(isFromWorker(received)).toBe(true);
      expect(plain(received)).toEqual(plain(message));
    },
  );

  it('covers every message type of both directions', () => {
    expect(new Set(toWorker.map((message) => message.type))).toEqual(
      new Set(['connect', 'token', 'watch', 'seed', 'retry', 'dispose']),
    );
    expect(new Set(fromWorker.map((message) => message.type))).toEqual(
      new Set(['tokenRequest', 'state', 'series', 'targets']),
    );
  });

  it('keeps the contents of typed arrays through a clone', () => {
    const series = fromWorker.find((message) => message.type === 'series');
    if (series?.type !== 'series') throw new Error('fixture missing');

    const copy = structuredClone(series);

    expect(Object.prototype.toString.call(copy.entries[0]?.t)).toBe('[object Float64Array]');
    expect([...(copy.entries[0]?.t ?? [])]).toEqual([1_000, 2_000, 3_000]);
    expect(Object.prototype.toString.call(copy.entries[0]?.v)).toBe('[object Float32Array]');
  });

  it('refuses a message of another version', () => {
    expect(isToWorker({ v: TELEMETRY_PROTOCOL_VERSION + 1, type: 'connect' })).toBe(false);
    expect(isFromWorker({ v: 0, type: 'state' })).toBe(false);
  });

  it('refuses a message with no version', () => {
    expect(isToWorker({ type: 'connect' })).toBe(false);
    expect(isFromWorker({ type: 'series' })).toBe(false);
  });

  it('refuses an unknown type', () => {
    expect(isToWorker({ v, type: 'shutdown' })).toBe(false);
    expect(isFromWorker({ v, type: 'explode' })).toBe(false);
  });

  it('refuses what is not an object', () => {
    for (const value of [null, undefined, 'connect', 42, true, ['connect']]) {
      expect(isToWorker(value)).toBe(false);
      expect(isFromWorker(value)).toBe(false);
    }
  });

  it('does not take one direction for the other', () => {
    expect(isToWorker({ v, type: 'tokenRequest' })).toBe(false);
    expect(isFromWorker({ v, type: 'watch' })).toBe(false);
  });
});
