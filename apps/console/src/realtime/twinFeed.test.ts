import type { Asset, Incident, IncidentDetail, TelemetryPoint } from '@occ/contracts';
import {
  type AssetTelemetryState,
  initialTelemetryState,
  type TelemetryState,
} from '../lib/telemetryState';
import type { Binding, Motion } from '../lib/twinBindings';
import type { TargetsView, TelemetryClient, TelemetryView } from './telemetryClient';
import type { TargetSlot } from './telemetryProtocol';
import { useTelemetryStore } from './telemetryStore';
import { createTwinFeed } from './twinFeed';

const NOW = Date.parse('2026-10-15T08:00:00.000Z');
const MONO = 5_000;
const iso = (ms: number) => new Date(ms).toISOString();

// --- fixtures ----------------------------------------------------------------------------------------------

const point = (key: string, headline: 1 | 2, expectedIntervalS: number): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS,
  headline,
});

/** 1 s and 5 s headline points: stale after the 5 s floor (3 × 1 s is below it). */
const asset = (code: string, id: string, classCode: string): Asset => ({
  id,
  code,
  name: code,
  class: {
    id: `class-${classCode}`,
    code: classCode,
    name: classCode,
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point('fanSpeedRpm', 1, 1), point('motorTempC', 2, 5)],
});

const CT01 = asset('CT-01', 'asset-ct-01', 'cooling_tower');
const CT02 = asset('CT-02', 'asset-ct-02', 'cooling_tower');
const AHU = asset('AHU-C1', 'asset-ahu-c1', 'air_handler');

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc-1',
  code: 'INC-000108',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Motor over-temperature — Cooling tower 1',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: 'asset-ct-01',
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

const detailOf = (base: Incident, note: string | null): IncidentDetail => ({
  ...base,
  timeline: [
    {
      id: 'event-1',
      kind: 'reported',
      note,
      at: base.reportedAt,
      actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry' },
    },
  ],
});

const entryAt = (receivedAtMs: number, online = true): AssetTelemetryState => ({
  online,
  receivedAt: iso(receivedAtMs),
  headline: {},
  values: {},
  keyReceivedAt: {},
});

/** What a model's `extras` bind: a key, and for an enum its values. */
const binding = (
  key: string,
  enumValues: string[] | null = null,
  motion: Motion = 'tint',
): Binding => ({
  node: key,
  key,
  motion,
  point: {
    kind: enumValues === null ? 'number' : 'enum',
    min: enumValues === null ? 0 : null,
    max: enumValues === null ? 100 : null,
    enumValues,
  },
  parent: null,
});

// --- a fake client and a rig ---------------------------------------------------------------------------------

/** The telemetry client as the feed sees it: a view it can read, listeners, and the layouts it was given. */
function createFakeClient() {
  let view: TelemetryView = { state: initialTelemetryState, series: new Map() };
  const viewListeners = new Set<() => void>();
  const targetListeners = new Set<(targets: TargetsView) => void>();
  const layouts: { id: number; slots: readonly TargetSlot[] }[] = [];
  let layoutId = 0;

  const client: TelemetryClient = {
    subscribe: (listener) => {
      viewListeners.add(listener);
      return () => void viewListeners.delete(listener);
    },
    getView: () => view,
    setWatch: vi.fn(),
    retry: vi.fn(),
    setLayout: vi.fn((slots: readonly TargetSlot[]) => {
      layoutId += 1;
      layouts.push({ id: layoutId, slots });
      return layoutId;
    }),
    onTargets: (listener) => {
      targetListeners.add(listener);
      return () => void targetListeners.delete(listener);
    },
    getTargets: () => null,
    getStats: () => ({ messages: 0, targetPosts: 0 }),
    dispose: vi.fn(),
  };

  return {
    client,
    layouts,
    viewListeners,
    targetListeners,
    /** A telemetry state message: the view changes and every subscriber is told, as the real client does. */
    setState(patch: Partial<TelemetryState>) {
      view = { ...view, state: { ...view.state, ...patch } };
      for (const listener of [...viewListeners]) listener();
    },
    emitTargets(id: number, ...numbers: number[]) {
      const targets: TargetsView = { layoutId: id, buffer: Float32Array.from(numbers) };
      for (const listener of [...targetListeners]) listener(targets);
      return targets;
    },
  };
}

let mono = MONO;
/** Time passes on both clocks: the monotonic one the feed reads and the timers it set. */
async function tick(ms: number) {
  mono += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

const feeds: { dispose(): void }[] = [];

function setup(initial: { assets?: Asset[]; incidents?: Incident[] } = {}) {
  const fake = createFakeClient();
  const data = {
    assets: initial.assets ?? [CT01, CT02, AHU],
    incidents: initial.incidents ?? [],
    details: new Map<string, IncidentDetail>(),
  };
  const invalidate = vi.fn();
  const feed = createTwinFeed({
    client: fake.client,
    getAssets: () => data.assets,
    getIncidents: () => data.incidents,
    getIncidentDetail: (id) => data.details.get(id),
    invalidate,
  });
  feeds.push(feed);
  return { ...fake, data, invalidate, feed };
}

/** The server's clock anchored at the moment the test starts, with CT-01 received just now. */
const LIVE: Partial<TelemetryState> = {
  serverClock: { at: NOW, mono: MONO },
  assets: { 'CT-01': entryAt(NOW) },
};

describe('twin feed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    mono = MONO;
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
  });

  afterEach(() => {
    for (const feed of feeds.splice(0)) feed.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('layout', () => {
    it('follows the bound keys of every asset of a class, in asset order then key order, as copies', () => {
      const { feed, layouts } = setup();
      const values = ['off', 'auto', 'hand'];

      feed.setBindings('cooling_tower', [
        binding('fanSpeedRpm'),
        binding('switchState', values),
        binding('fanSpeedRpm'),
      ]);

      expect(layouts).toHaveLength(1);
      expect(layouts[0]?.slots).toEqual([
        { assetCode: 'CT-01', key: 'fanSpeedRpm', enumValues: null },
        { assetCode: 'CT-01', key: 'switchState', enumValues: ['off', 'auto', 'hand'] },
        { assetCode: 'CT-02', key: 'fanSpeedRpm', enumValues: null },
        { assetCode: 'CT-02', key: 'switchState', enumValues: ['off', 'auto', 'hand'] },
      ]);
      expect(layouts[0]?.slots[1]?.enumValues).not.toBe(values);
      expect(feed.read().slotOf('CT-01', 'fanSpeedRpm')).toBe(0);
      expect(feed.read().slotOf('CT-02', 'switchState')).toBe(3);
      expect(feed.read().slotOf('CT-01', 'nope')).toBe(-1);
      expect(feed.read().slotOf('AHU-C1', 'fanSpeedRpm')).toBe(-1);
      expect(feed.read().slotOf('NOPE', 'fanSpeedRpm')).toBe(-1);
    });

    it('sends no layout while no class has bindings', async () => {
      const { feed, client } = setup();

      feed.refresh();
      await tick(3_000);

      expect(client.setLayout).not.toHaveBeenCalled();
      expect(feed.read().targets).toHaveLength(0);
    });

    it('sends an empty layout when the bindings go away after one was sent', () => {
      const { feed, layouts } = setup();
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);

      feed.setBindings('cooling_tower', []);

      expect(layouts.map((layout) => layout.slots.length)).toEqual([2, 0]);
      expect(feed.read().targets).toHaveLength(0);
    });

    it('sends a layout again only when it differs: other assets, other bindings', async () => {
      const { feed, layouts, data } = setup();
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);

      feed.refresh();
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);
      await tick(3_000);
      expect(layouts).toHaveLength(1);

      data.assets = [CT01];
      feed.refresh();
      expect(layouts).toHaveLength(2);
      expect(layouts[1]?.slots).toEqual([
        { assetCode: 'CT-01', key: 'fanSpeedRpm', enumValues: null },
      ]);

      feed.setBindings('cooling_tower', [binding('motorTempC')]);
      expect(layouts).toHaveLength(3);
    });

    it('does not invalidate, or send anything, when it is created', () => {
      const { invalidate, client } = setup();

      expect(invalidate).not.toHaveBeenCalled();
      expect(client.setLayout).not.toHaveBeenCalled();
    });
  });

  describe('targets', () => {
    it('is NaN until the first buffer, then the client’s buffer itself', () => {
      const { feed, emitTargets } = setup();
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);
      expect([...feed.read().targets]).toEqual([Number.NaN, Number.NaN]);

      const sent = emitTargets(1, 1420, 900);

      expect(feed.read().targets).toBe(sent.buffer);
      expect([...feed.read().targets]).toEqual([1420, 900]);
    });

    it('ignores a buffer for another layout, and one when no layout was sent', () => {
      const { feed, emitTargets, invalidate } = setup();
      emitTargets(1, 5);
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);
      invalidate.mockClear();

      emitTargets(2, 1, 2);
      emitTargets(0, 1, 2);

      expect(invalidate).not.toHaveBeenCalled();
      expect([...feed.read().targets]).toEqual([Number.NaN, Number.NaN]);
    });

    it('invalidates once for a buffer, and not for a telemetry change that changed nothing', () => {
      const { feed, setState, emitTargets, invalidate } = setup();
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);
      setState(LIVE);
      invalidate.mockClear();

      emitTargets(1, 1420, 900);
      expect(invalidate).toHaveBeenCalledTimes(1);

      // An overview that carries what the feed already knows: no flag moves.
      setState({ upstream: 'live' });
      setState({ assets: { ...LIVE.assets } });
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe('stale and online', () => {
    it('is stale at the next one-second tick after the threshold, with no message needed', async () => {
      const { feed, setState, invalidate } = setup();
      setState(LIVE);
      const fresh = feed.read().flags('CT-01');
      expect(fresh).toEqual({ stale: false, online: true, alarm: null, ruleKey: null });
      invalidate.mockClear();

      await tick(4_000);
      expect(feed.read().flags('CT-01')).toBe(fresh);
      expect(invalidate).not.toHaveBeenCalled();

      await tick(1_000);
      expect(feed.read().flags('CT-01')).toEqual({
        stale: true,
        online: true,
        alarm: null,
        ruleKey: null,
      });
      expect(invalidate).toHaveBeenCalledTimes(1);
    });

    it('is not stale while there is no server clock to judge by', () => {
      const { feed, setState } = setup();

      setState({ assets: { 'CT-01': entryAt(NOW - 3_600_000) } });

      expect(feed.read().flags('CT-01').stale).toBe(false);
    });

    it('reads an asset with no entry, and an unknown code, as no data', () => {
      const { feed } = setup();

      const nothing = { stale: true, online: false, alarm: null, ruleKey: null };
      expect(feed.read().flags('CT-02')).toEqual(nothing);
      expect(feed.read().flags('NOPE')).toEqual(nothing);
    });

    it('keeps online false for an asset whose last will fired, however fresh', () => {
      const { feed, setState } = setup();

      setState({ ...LIVE, assets: { 'CT-01': entryAt(NOW, false) } });

      expect(feed.read().flags('CT-01')).toEqual({
        stale: false,
        online: false,
        alarm: null,
        ruleKey: null,
      });
    });

    it('forgets an asset that left the list, and invalidates', () => {
      const { feed, setState, data, invalidate } = setup();
      setState(LIVE);
      invalidate.mockClear();

      data.assets = [CT02, AHU];
      feed.refresh();

      expect(feed.read().flags('CT-01')).toEqual({
        stale: true,
        online: false,
        alarm: null,
        ruleKey: null,
      });
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe('alarm', () => {
    it('sets alarm to the severity of an open incident at the next tick, and clears it when resolved', async () => {
      const { feed, setState, data, invalidate } = setup();
      setState(LIVE);
      invalidate.mockClear();

      data.incidents = [incident({ severity: 'critical' })];
      expect(feed.read().flags('CT-01').alarm).toBeNull();
      await tick(1_000);
      expect(feed.read().flags('CT-01').alarm).toBe('critical');
      expect(feed.read().flags('CT-02').alarm).toBeNull();
      expect(invalidate).toHaveBeenCalledTimes(1);

      data.incidents = [incident({ severity: 'critical', status: 'resolved', version: 2 })];
      feed.refresh();
      expect(feed.read().flags('CT-01').alarm).toBeNull();
      expect(invalidate).toHaveBeenCalledTimes(2);
    });

    it('takes the most severe of several open incidents of the asset', () => {
      const { feed, data } = setup();

      data.incidents = [
        incident({ id: 'inc-1', severity: 'high' }),
        incident({ id: 'inc-2', severity: 'critical' }),
        incident({ id: 'inc-3', severity: 'low' }),
      ];
      feed.refresh();

      expect(feed.read().flags('CT-01').alarm).toBe('critical');
    });

    it('does not hide a fault behind a stale reading', async () => {
      const { feed, setState, data } = setup();
      setState({ ...LIVE, assets: { 'CT-01': entryAt(NOW - 60_000) } });
      data.incidents = [incident({ severity: 'high' })];

      await tick(1_000);

      expect(feed.read().flags('CT-01')).toEqual({
        stale: true,
        online: true,
        alarm: 'high',
        ruleKey: null,
      });
    });

    it('names the rule’s point from the incident’s cached detail, and only then', async () => {
      const { feed, data, invalidate } = setup();
      const open = incident({ severity: 'critical' });
      data.incidents = [open];
      feed.refresh();
      expect(feed.read().flags('CT-01').ruleKey).toBeNull();
      invalidate.mockClear();

      data.details.set(open.id, detailOf(open, 'motorTempC 92 > 85 for 60 s'));
      await tick(1_000);
      expect(feed.read().flags('CT-01')).toEqual({
        stale: true,
        online: false,
        alarm: 'critical',
        ruleKey: 'motorTempC',
      });
      expect(invalidate).toHaveBeenCalledTimes(1);

      data.details.set(open.id, detailOf(open, 'Guard dispatched'));
      await tick(1_000);
      expect(feed.read().flags('CT-01').ruleKey).toBeNull();

      data.details.set(open.id, { ...open, timeline: [] });
      await tick(1_000);
      expect(feed.read().flags('CT-01').ruleKey).toBeNull();
    });
  });

  describe('reading it', () => {
    it('sets no React state: a buffer, a tick, a read and a flag touch no store', async () => {
      const { feed, setState, emitTargets, data } = setup();
      const updates = vi.fn();
      const stop = useTelemetryStore.subscribe(updates);

      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);
      setState(LIVE);
      emitTargets(1, 1420, 900);
      data.incidents = [incident()];
      await tick(2_000);
      feed.read().flags('CT-01');
      feed.read().slotOf('CT-01', 'fanSpeedRpm');
      stop();

      expect(updates).not.toHaveBeenCalled();
    });

    it('returns one stable reader, and a flags object that changes only when a field does', async () => {
      const { feed, setState, data } = setup();
      setState(LIVE);
      const reader = feed.read();
      const before = reader.flags('CT-01');

      feed.refresh();
      await tick(3_000);
      expect(feed.read()).toBe(reader);
      expect(reader.flags('CT-01')).toBe(before);

      data.incidents = [incident()];
      feed.refresh();
      expect(reader.flags('CT-01')).not.toBe(before);
    });

    it('invalidates once for a trigger that changed the layout and a flag together', () => {
      const { feed, data, invalidate } = setup();
      invalidate.mockClear();

      data.incidents = [incident()];
      feed.setBindings('air_handler', [binding('supplyAirTempC')]);

      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('stops the timer and both listeners, stops the worker’s posts, and later changes do nothing', async () => {
      const {
        feed,
        setState,
        emitTargets,
        data,
        invalidate,
        client,
        layouts,
        viewListeners,
        targetListeners,
      } = setup();
      feed.setBindings('cooling_tower', [binding('fanSpeedRpm')]);
      invalidate.mockClear();

      feed.dispose();
      feed.dispose();
      setState(LIVE);
      emitTargets(1, 1, 2);
      data.incidents = [incident()];
      feed.setBindings('air_handler', [binding('supplyAirTempC')]);
      await tick(5_000);

      expect(viewListeners.size).toBe(0);
      expect(targetListeners.size).toBe(0);
      expect(invalidate).not.toHaveBeenCalled();
      // The layout it sent, then one empty layout, once.
      expect(client.setLayout).toHaveBeenCalledTimes(2);
      expect(layouts[1]?.slots).toEqual([]);
      expect(feed.read().flags('CT-01').alarm).toBeNull();
    });

    it('sends nothing when no layout was ever sent', () => {
      const { feed, client } = setup();

      feed.dispose();

      expect(client.setLayout).not.toHaveBeenCalled();
    });
  });
});
