import type {
  TelemetryAssetOverview,
  TelemetryAssetSnapshot,
  TelemetryFrame,
} from '@occ/contracts';
import { serverNow } from './telemetryFreshness';
import {
  applyMessage,
  initialTelemetryState,
  type SocketState,
  type TelemetryMessage,
  telemetryPillState,
  type TelemetryState,
} from './telemetryState';

const T0 = '2026-10-15T08:00:00.000Z';
const T1 = '2026-10-15T08:00:01.000Z';
const T2 = '2026-10-15T08:00:02.000Z';
const T5 = '2026-10-15T08:00:05.000Z';

const overviewEntry = (
  receivedAt: string,
  headline: TelemetryAssetOverview['headline'],
  online = true,
): TelemetryAssetOverview => ({ online, receivedAt, headline });

const snapshotEntry = (
  receivedAt: string,
  values: TelemetryAssetSnapshot['values'],
  online = true,
): TelemetryAssetSnapshot => ({ online, receivedAt, values });

const overview = (
  at: string,
  assets: Record<string, TelemetryAssetOverview>,
): TelemetryMessage => ({ type: 'overview', payload: { at, assets } });

const snapshot = (
  at: string,
  assets: Record<string, TelemetryAssetSnapshot>,
): TelemetryMessage => ({ type: 'snapshot', payload: { at, assets } });

const frames = (...entries: TelemetryFrame[]): TelemetryMessage => ({
  type: 'frames',
  payload: { frames: entries },
});

const frame = (
  assetCode: string,
  receivedAt: string,
  values: TelemetryFrame['values'],
): TelemetryFrame => ({ assetCode, at: receivedAt, receivedAt, values });

const apply = (state: TelemetryState, message: TelemetryMessage, mono = 1_000) =>
  applyMessage(state, message, mono);

/** A state that holds CT-01 and CT-02 as the connect snapshot leaves them. */
const connected = (): TelemetryState =>
  apply(
    initialTelemetryState,
    snapshot(T0, {
      'CT-01': snapshotEntry(T0, { fanSpeedRpm: 1420, motorTempC: 70, running: true }),
      'CT-02': snapshotEntry(T0, { fanSpeedRpm: 0, motorTempC: 31, running: false }),
    }),
  );

describe('initialTelemetryState', () => {
  it('knows nothing: connecting, no upstream, no clock, no assets', () => {
    expect(initialTelemetryState).toEqual({
      upstream: null,
      upstreamSince: null,
      socket: 'connecting',
      socketSince: null,
      serverClock: null,
      assets: {},
    });
  });
});

describe('applyMessage — snapshot', () => {
  it('adds each listed asset with its values, online state and time', () => {
    const state = connected();

    expect(state.assets['CT-01']).toEqual({
      online: true,
      receivedAt: T0,
      headline: {},
      values: { fanSpeedRpm: 1420, motorTempC: 70, running: true },
      keyReceivedAt: { fanSpeedRpm: T0, motorTempC: T0, running: T0 },
    });
  });

  it('replaces only the listed assets and leaves the others alone', () => {
    const state = connected();
    const before = state.assets['CT-02'];

    const next = apply(state, snapshot(T1, { 'CT-01': snapshotEntry(T1, { fanSpeedRpm: 900 }) }));

    expect(next.assets['CT-01']?.values).toEqual({ fanSpeedRpm: 900 });
    expect(next.assets['CT-02']).toBe(before);
  });

  it('keeps the stamp of a key whose value did not change', () => {
    const state = connected();

    const next = apply(
      state,
      snapshot(T5, {
        'CT-01': snapshotEntry(T5, { fanSpeedRpm: 1420, motorTempC: 75, running: true }),
      }),
    );

    expect(next.assets['CT-01']?.keyReceivedAt).toEqual({
      fanSpeedRpm: T0,
      motorTempC: T5,
      running: T0,
    });
  });

  it('does not create an asset from a malformed time', () => {
    const next = apply(
      initialTelemetryState,
      snapshot(T0, { 'CT-01': snapshotEntry('not a time', { fanSpeedRpm: 1 }) }),
    );

    expect(next.assets).toEqual({});
  });

  it('anchors the server clock on its own time', () => {
    const next = apply(initialTelemetryState, snapshot(T0, {}), 4_000);

    expect(next.serverClock).toEqual({ at: Date.parse(T0), mono: 4_000 });
  });
});

describe('applyMessage — overview', () => {
  it('anchors the server clock on the overview time and the arrival instant', () => {
    const next = apply(initialTelemetryState, overview(T1, {}), 2_500);

    expect(next.serverClock).toEqual({ at: Date.parse(T1), mono: 2_500 });
    expect(serverNow(next.serverClock, 4_500)).toBe(Date.parse(T1) + 2_000);
  });

  it('re-anchors on every overview', () => {
    const first = apply(initialTelemetryState, overview(T1, {}), 1_000);

    const second = apply(first, overview(T2, {}), 2_000);

    expect(second.serverClock).toEqual({ at: Date.parse(T2), mono: 2_000 });
  });

  it('keeps the clock when the overview time is malformed', () => {
    const anchored = apply(initialTelemetryState, overview(T1, {}), 1_000);

    const next = apply(anchored, overview('garbage', {}), 2_000);

    expect(next.serverClock).toBe(anchored.serverClock);
  });

  it('sets the headline, and lays it over the values the snapshot gave', () => {
    const next = apply(
      connected(),
      overview(T1, { 'CT-01': overviewEntry(T1, { fanSpeedRpm: 1500, motorTempC: 70 }) }),
    );

    const asset = next.assets['CT-01'];
    expect(asset?.headline).toEqual({ fanSpeedRpm: 1500, motorTempC: 70 });
    expect(asset?.values).toEqual({ fanSpeedRpm: 1500, motorTempC: 70, running: true });
    expect(asset?.receivedAt).toBe(T1);
  });

  it('stamps only the headline keys whose value changed', () => {
    const next = apply(
      connected(),
      overview(T1, { 'CT-01': overviewEntry(T1, { fanSpeedRpm: 1500, motorTempC: 70 }) }),
    );

    expect(next.assets['CT-01']?.keyReceivedAt).toEqual({
      fanSpeedRpm: T1,
      motorTempC: T0,
      running: T0,
    });
  });

  it('records an asset that went offline', () => {
    const next = apply(
      connected(),
      overview(T1, { 'CT-01': overviewEntry(T0, { fanSpeedRpm: 1420 }, false) }),
    );

    expect(next.assets['CT-01']?.online).toBe(false);
  });

  it('does not read an asset it does not list as zeros: it is simply not there', () => {
    const next = apply(
      initialTelemetryState,
      overview(T1, { 'CT-01': overviewEntry(T1, { fanSpeedRpm: 1420 }) }),
    );

    expect(next.assets['CT-02']).toBeUndefined();
    expect(Object.keys(next.assets)).toEqual(['CT-01']);
  });

  it('never moves receivedAt backwards', () => {
    const state = apply(connected(), frames(frame('CT-01', T2, { fanSpeedRpm: 1600 })));

    const next = apply(state, overview(T1, { 'CT-01': overviewEntry(T1, { fanSpeedRpm: 1600 }) }));

    expect(next.assets['CT-01']?.receivedAt).toBe(T2);
  });

  it('ignores an entry whose time is malformed', () => {
    const state = connected();

    const next = apply(state, overview(T1, { 'CT-01': overviewEntry('nope', { fanSpeedRpm: 1 }) }));

    expect(next.assets['CT-01']).toBe(state.assets['CT-01']);
  });

  it('keeps the same asset objects and assets reference when nothing about them changed', () => {
    const state = apply(
      connected(),
      overview(T1, {
        'CT-01': overviewEntry(T1, { fanSpeedRpm: 1420, motorTempC: 70 }),
        'CT-02': overviewEntry(T0, { fanSpeedRpm: 0, motorTempC: 31 }),
      }),
    );

    const next = apply(
      state,
      overview(T2, {
        'CT-01': overviewEntry(T1, { fanSpeedRpm: 1420, motorTempC: 70 }),
        'CT-02': overviewEntry(T0, { fanSpeedRpm: 0, motorTempC: 31 }),
      }),
    );

    expect(next.assets).toBe(state.assets);
    expect(next.serverClock).not.toBe(state.serverClock);
  });

  it('changes only the asset that changed', () => {
    const state = apply(
      connected(),
      overview(T1, {
        'CT-01': overviewEntry(T1, { fanSpeedRpm: 1420 }),
        'CT-02': overviewEntry(T0, { fanSpeedRpm: 0 }),
      }),
    );

    const next = apply(
      state,
      overview(T2, {
        'CT-01': overviewEntry(T2, { fanSpeedRpm: 1450 }),
        'CT-02': overviewEntry(T0, { fanSpeedRpm: 0 }),
      }),
    );

    expect(next.assets['CT-01']).not.toBe(state.assets['CT-01']);
    expect(next.assets['CT-02']).toBe(state.assets['CT-02']);
  });
});

describe('applyMessage — frames', () => {
  it('merges only the keys it carries', () => {
    const next = apply(connected(), frames(frame('CT-01', T1, { motorTempC: 71 })));

    expect(next.assets['CT-01']?.values).toEqual({
      fanSpeedRpm: 1420,
      motorTempC: 71,
      running: true,
    });
  });

  it('stamps the keys it carries with its receive time and no others', () => {
    const next = apply(connected(), frames(frame('CT-01', T1, { motorTempC: 71 })));

    expect(next.assets['CT-01']?.keyReceivedAt).toEqual({
      fanSpeedRpm: T0,
      motorTempC: T1,
      running: T0,
    });
    expect(next.assets['CT-01']?.receivedAt).toBe(T1);
  });

  it('applies every entry of a batch, one per asset', () => {
    const next = apply(
      connected(),
      frames(frame('CT-01', T1, { fanSpeedRpm: 1500 }), frame('CT-02', T1, { fanSpeedRpm: 600 })),
    );

    expect(next.assets['CT-01']?.values.fanSpeedRpm).toBe(1500);
    expect(next.assets['CT-02']?.values.fanSpeedRpm).toBe(600);
  });

  it('brings an asset back online: a reading arrived', () => {
    const offline = apply(
      connected(),
      overview(T1, { 'CT-01': overviewEntry(T0, { fanSpeedRpm: 1420 }, false) }),
    );

    const next = apply(offline, frames(frame('CT-01', T2, { fanSpeedRpm: 1400 })));

    expect(next.assets['CT-01']?.online).toBe(true);
  });

  it('creates an asset it has not heard of, from the keys it carries', () => {
    const next = apply(initialTelemetryState, frames(frame('CT-09', T1, { fanSpeedRpm: 500 })));

    expect(next.assets['CT-09']).toEqual({
      online: true,
      receivedAt: T1,
      headline: {},
      values: { fanSpeedRpm: 500 },
      keyReceivedAt: { fanSpeedRpm: T1 },
    });
  });

  it('does not use the frame time of the device, nor move the server clock', () => {
    const anchored = apply(initialTelemetryState, overview(T1, {}), 1_000);

    const next = apply(
      anchored,
      frames({
        assetCode: 'CT-01',
        at: '2026-10-15T07:55:00.000Z',
        receivedAt: T2,
        values: { fanSpeedRpm: 1 },
      }),
    );

    expect(next.serverClock).toBe(anchored.serverClock);
    expect(next.assets['CT-01']?.receivedAt).toBe(T2);
  });

  it('does not move receivedAt backwards on a late frame', () => {
    const state = apply(connected(), frames(frame('CT-01', T2, { fanSpeedRpm: 1600 })));

    const next = apply(state, frames(frame('CT-01', T1, { motorTempC: 72 })));

    expect(next.assets['CT-01']?.receivedAt).toBe(T2);
    expect(next.assets['CT-01']?.values.motorTempC).toBe(72);
  });

  it('ignores a frame whose time is malformed', () => {
    const state = connected();

    const next = apply(state, frames(frame('CT-01', 'nope', { fanSpeedRpm: 1 })));

    expect(next.assets['CT-01']).toBe(state.assets['CT-01']);
  });

  it('keeps the other assets untouched', () => {
    const state = connected();

    const next = apply(state, frames(frame('CT-01', T1, { motorTempC: 71 })));

    expect(next.assets['CT-02']).toBe(state.assets['CT-02']);
  });
});

describe('applyMessage — status', () => {
  it('records the upstream state and since when', () => {
    const next = apply(initialTelemetryState, {
      type: 'status',
      payload: { upstream: 'paused', since: T1 },
    });

    expect(next.upstream).toBe('paused');
    expect(next.upstreamSince).toBe(T1);
  });

  it('leaves the assets alone: what is held is still the latest known', () => {
    const state = connected();

    const next = apply(state, { type: 'status', payload: { upstream: 'paused', since: T1 } });

    expect(next.assets).toBe(state.assets);
  });

  it('returns the same state when nothing changed', () => {
    const state = apply(initialTelemetryState, {
      type: 'status',
      payload: { upstream: 'live', since: T0 },
    });

    expect(apply(state, { type: 'status', payload: { upstream: 'live', since: T0 } })).toBe(state);
  });
});

describe('applyMessage — socket', () => {
  const socket = (state: SocketState, at: number): TelemetryMessage => ({
    type: 'socket',
    state,
    at,
  });

  it('is not "since" while live', () => {
    const next = apply(initialTelemetryState, socket('live', 1_000));

    expect(next.socket).toBe('live');
    expect(next.socketSince).toBeNull();
  });

  it('records when the socket stopped being live and keeps it through reconnect attempts', () => {
    const live = apply(initialTelemetryState, socket('live', 1_000));

    const lost = apply(live, socket('reconnecting', 5_000));
    const stillLost = apply(lost, socket('reconnecting', 9_000));

    expect(lost.socketSince).toBe(5_000);
    expect(stillLost.socketSince).toBe(5_000);
  });

  it('clears "since" when it is live again', () => {
    const lost = apply(
      apply(initialTelemetryState, socket('live', 1_000)),
      socket('reconnecting', 5_000),
    );

    expect(apply(lost, socket('live', 9_000)).socketSince).toBeNull();
  });

  it('keeps the upstream state: it is the API source, not this socket', () => {
    const paused = apply(initialTelemetryState, {
      type: 'status',
      payload: { upstream: 'paused', since: T1 },
    });

    const next = apply(paused, socket('reconnecting', 5_000));

    expect(next.upstream).toBe('paused');
  });
});

describe('telemetryPillState', () => {
  const state = (patch: Partial<TelemetryState>): TelemetryState => ({
    ...initialTelemetryState,
    ...patch,
  });

  it.each([
    ['connecting', { socket: 'connecting' }, 'connecting'],
    ['live socket, upstream live', { socket: 'live', upstream: 'live' }, 'live'],
    ['live socket, upstream paused', { socket: 'live', upstream: 'paused' }, 'paused'],
    ['live socket, no status heard yet', { socket: 'live', upstream: null }, 'connecting'],
    ['socket reconnecting', { socket: 'reconnecting', upstream: 'live' }, 'reconnecting'],
    [
      'reconnecting over a paused upstream',
      { socket: 'reconnecting', upstream: 'paused' },
      'reconnecting',
    ],
    ['namespace missing', { socket: 'unavailable', upstream: null }, 'unavailable'],
  ] as const)('%s', (_name, patch, expected) => {
    expect(telemetryPillState(state(patch))).toBe(expected);
  });
});

describe('purity', () => {
  it('mutates neither the state nor the message', () => {
    const state = connected();
    const message = frames(frame('CT-01', T1, { motorTempC: 71 }));
    const stateBefore = JSON.stringify(state);
    const messageBefore = JSON.stringify(message);

    apply(state, message);
    apply(state, overview(T2, { 'CT-01': overviewEntry(T2, { fanSpeedRpm: 1 }) }));
    apply(state, snapshot(T2, { 'CT-02': snapshotEntry(T2, { fanSpeedRpm: 2 }) }));

    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(JSON.stringify(message)).toBe(messageBefore);
  });
});
