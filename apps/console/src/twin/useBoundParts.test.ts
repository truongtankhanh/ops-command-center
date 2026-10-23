import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { Group, type Object3D, Quaternion, Vector3 } from 'three';
import { initialTelemetryState, type SocketState } from '../lib/telemetry/telemetryState';
import type { Axis, Binding, BindingPoint, Motion } from '../lib/twin-core/twinBindings';
import { integrateAngle, MAX_FRAME_DT_S, spinSpeed } from '../lib/twin-core/twinMotion';
import { createFrameDemand, type FrameReport, needsFrame } from '../lib/twin-core/twinPerf';
import { useTelemetryStore } from '../realtime/telemetryStore';
import type { AssetFlags, TwinFeed } from '../realtime/twinFeed';
import { FrameDemandContext } from './FrameDemandContext';
import { type BoundInstance, useBoundParts } from './useBoundParts';

/*
 * The loop is driven by hand: `useFrame` is replaced by a function that keeps the callback, and a test calls it
 * with a fake state and a `delta`. The feed is a fake reader, the nodes are real three objects (no WebGL needed).
 */
const frame = vi.hoisted(() => ({
  callback: null as null | ((state: { invalidate: () => void }, delta: number) => void),
  priority: undefined as number | undefined,
}));

vi.mock('@react-three/fiber', () => ({
  useFrame: (
    callback: (state: { invalidate: () => void }, delta: number) => void,
    priority?: number,
  ) => {
    frame.callback = callback;
    frame.priority = priority;
  },
}));

// --- fixtures -----------------------------------------------------------------------------------------------

const NUMBER_0_100: BindingPoint = { kind: 'number', min: 0, max: 100, enumValues: null };
const NUMBER_RPM: BindingPoint = { kind: 'number', min: 0, max: 1800, enumValues: null };

const binding = (
  node: string,
  key: string,
  motion: Motion,
  point: BindingPoint,
  axis?: Axis,
  range?: [number, number],
): Binding => ({
  node,
  key,
  motion,
  point,
  parent: null,
  ...(axis === undefined || range === undefined ? {} : { axis, range }),
});

const FAN = binding('FanBlade', 'fanSpeedRpm', 'spin', NUMBER_RPM, 'y', [0, 1800]);
const VALVE = binding('Valve', 'valveOpenPct', 'turn', NUMBER_0_100, 'x', [0, 90]);
const SWITCH = binding('Switch', 'switchPct', 'turn', NUMBER_0_100, 'x', [-35, 35]);
const ROD_Z = binding('Rod', 'rodPct', 'slide', NUMBER_0_100, 'z', [0, 2]);
const ROD_X = binding('Rod', 'rodPct', 'slide', NUMBER_0_100, 'x', [0, 2]);
const MOTOR = binding('FanMotor', 'motorTempC', 'tint', NUMBER_0_100);

const TOWER = [FAN, VALVE, SWITCH, MOTOR];

const LIVE: AssetFlags = { stale: false, online: true, alarm: null, ruleKey: null };
const STALE: AssetFlags = { ...LIVE, stale: true };
const OFFLINE: AssetFlags = { ...LIVE, online: false };

/** A model instance: a root with one child per name. */
function modelOf(...names: string[]): Group {
  const root = new Group();
  root.name = 'CoolingTower';
  for (const name of names) {
    const node = new Group();
    node.name = name;
    root.add(node);
  }
  return root;
}

const instanceOf = (
  assetCode: string,
  bindings: readonly Binding[],
  object: Object3D = modelOf('FanBlade', 'Valve', 'Switch', 'FanMotor', 'Rod'),
): BoundInstance => ({ assetCode, object, bindings });

const node = (instance: BoundInstance, name: string): Object3D =>
  instance.object.getObjectByName(name)!;

/** The angle of a node's rotation about one axis, in radians. */
const angleAbout = (object: Object3D, axis: 'x' | 'y' | 'z'): number =>
  2 * Math.atan2(object.quaternion[axis], object.quaternion.w);

const FRAME_S = 1 / 60;

/** A fake feed: a slot per `asset|key`, a buffer the test writes, flags per asset, and a layout number. */
function createRig(keys: readonly string[]) {
  const slots = new Map(keys.map((key, index) => [key, index]));
  const rig = {
    targets: new Float32Array(keys.length).fill(Number.NaN),
    layout: 1,
    flags: new Map<string, AssetFlags>(),
    slotOf: vi.fn((code: string, key: string) => slots.get(`${code}|${key}`) ?? -1),
  };
  const reader = {
    get targets() {
      return rig.targets;
    },
    get layout() {
      return rig.layout;
    },
    slotOf: rig.slotOf,
    flags: (code: string) => rig.flags.get(code) ?? LIVE,
  };
  const feed = { read: () => reader } as unknown as TwinFeed;
  return {
    feed,
    rig,
    set(key: string, value: number) {
      rig.targets[slots.get(key)!] = value;
    },
  };
}

/**
 * `invalidate` is what `FrameDriver` does at the end of a frame when a loop asked (V2-19.2): the loop under test reports
 * through the frame demand and never asks R3F itself, so the state it is given has its own `invalidate`, which must stay
 * unused (`hookInvalidate`).
 */
const invalidate = vi.fn();
const hookInvalidate = vi.fn();
let demand = createFrameDemand();
/** What `FrameDriver` provides: it writes the field of the demand the case reads. */
const report: FrameReport = (field, asking) => {
  demand[field] = asking;
};

/** One frame of the loop, then the driver's decision. */
function tick(delta = FRAME_S) {
  frame.callback!({ invalidate: hookInvalidate }, delta);
  if (needsFrame(demand)) invalidate();
}

function ticks(count: number, delta = FRAME_S) {
  for (let i = 0; i < count; i += 1) tick(delta);
}

function mount(feed: TwinFeed | null, instances: readonly BoundInstance[]) {
  return renderHook(
    (props: { instances: readonly BoundInstance[] }) => useBoundParts(feed, props.instances),
    {
      initialProps: { instances },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(FrameDemandContext.Provider, { value: report }, children),
    },
  );
}

const setSocket = (socket: SocketState) =>
  act(() => {
    useTelemetryStore.setState({
      view: { state: { ...initialTelemetryState, socket }, series: new Map() },
    });
  });

describe('useBoundParts', () => {
  beforeEach(() => {
    frame.callback = null;
    frame.priority = undefined;
    invalidate.mockClear();
    hookInvalidate.mockClear();
    demand = createFrameDemand();
  });

  afterEach(() => {
    useTelemetryStore.setState({
      client: null,
      view: { state: initialTelemetryState, series: new Map() },
    });
  });

  describe('a turn', () => {
    it('takes the angle its reading maps to, about its own axis', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);

      set('CT-01|valveOpenPct', 50);
      tick();

      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeCloseTo(Math.PI / 4, 9);
      expect(angleAbout(node(tower, 'Valve'), 'y')).toBeCloseTo(0, 9);
    });

    it('eases a small step instead of jumping, and arrives', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);
      set('CT-01|valveOpenPct', 50);
      tick();

      set('CT-01|valveOpenPct', 60);
      tick();
      const after = angleAbout(node(tower, 'Valve'), 'x');
      expect(after).toBeGreaterThan(Math.PI / 4);
      expect(after).toBeLessThan((54 * Math.PI) / 180);

      ticks(120);
      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeCloseTo((54 * Math.PI) / 180, 9);
    });

    it('is composed with the rotation the model was authored in', () => {
      const tower = instanceOf('CT-01', TOWER);
      const valve = node(tower, 'Valve');
      valve.rotation.y = Math.PI / 2;
      const rest = valve.quaternion.clone();
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);

      set('CT-01|valveOpenPct', 100);
      tick();

      const expected = rest
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
      expect(valve.quaternion.angleTo(expected)).toBeCloseTo(0, 9);
    });

    it('leaves a part at its authored pose while it has no value', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { feed } = createRig(['CT-01|valveOpenPct', 'CT-01|switchPct']);
      mount(feed, [tower]);

      ticks(5);

      expect(node(tower, 'Valve').quaternion.angleTo(new Quaternion())).toBe(0);
      expect(node(tower, 'Switch').quaternion.angleTo(new Quaternion())).toBe(0);
    });
  });

  describe('a slide', () => {
    it('moves along its own axis from the authored position', () => {
      const tower = instanceOf('CT-01', [ROD_Z]);
      node(tower, 'Rod').position.set(1, 0, 0.5);
      const { set, feed } = createRig(['CT-01|rodPct']);
      mount(feed, [tower]);

      set('CT-01|rodPct', 50);
      tick();

      expect(node(tower, 'Rod').position.toArray()).toEqual([1, 0, 1.5]);
    });

    it('runs along the axis as the authored rotation turns it', () => {
      const tower = instanceOf('CT-01', [ROD_X]);
      const rod = node(tower, 'Rod');
      rod.rotation.y = Math.PI / 2;
      const { set, feed } = createRig(['CT-01|rodPct']);
      mount(feed, [tower]);

      set('CT-01|rodPct', 100);
      tick();

      // Local +x turned a quarter about +y is −z in the parent.
      expect(rod.position.x).toBeCloseTo(0, 9);
      expect(rod.position.z).toBeCloseTo(-2, 9);
    });
  });

  describe('a spin', () => {
    it('turns while its reading is above zero, and asks for a frame at every step', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);

      ticks(30);

      expect(angleAbout(node(tower, 'FanBlade'), 'y')).not.toBe(0);
      expect(invalidate).toHaveBeenCalledTimes(30);
    });

    it('turns faster for a larger reading', () => {
      const slow = instanceOf('CT-01', TOWER);
      const fast = instanceOf('CT-02', TOWER);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm', 'CT-02|fanSpeedRpm']);
      mount(feed, [slow, fast]);
      set('CT-01|fanSpeedRpm', 900);
      set('CT-02|fanSpeedRpm', 1800);

      ticks(10);

      const slowAngle = angleAbout(node(slow, 'FanBlade'), 'y');
      const fastAngle = angleAbout(node(fast, 'FanBlade'), 'y');
      expect(fastAngle).toBeGreaterThan(slowAngle);
      expect(slowAngle).toBeCloseTo(integrateAngle(0, 0.75, 10 * FRAME_S), 9);
      expect(fastAngle).toBeCloseTo(integrateAngle(0, 1.5, 10 * FRAME_S), 9);
    });

    it('eases to a stop within a second of its reading dropping to zero, then asks for no more frames', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 600);
      ticks(30);

      set('CT-01|fanSpeedRpm', 0);
      invalidate.mockClear();
      ticks(60);

      expect(invalidate.mock.calls.length).toBeGreaterThan(10);
      expect(invalidate.mock.calls.length).toBeLessThan(60);
      const stopped = angleAbout(node(tower, 'FanBlade'), 'y');
      invalidate.mockClear();
      ticks(10);
      expect(invalidate).not.toHaveBeenCalled();
      expect(angleAbout(node(tower, 'FanBlade'), 'y')).toBe(stopped);
    });

    it('advances by the same angle for a long pause as for the longest step', () => {
      const long = instanceOf('CT-01', TOWER);
      const capped = instanceOf('CT-02', TOWER);
      const a = createRig(['CT-01|fanSpeedRpm']);
      const b = createRig(['CT-02|fanSpeedRpm']);
      a.set('CT-01|fanSpeedRpm', 900);
      b.set('CT-02|fanSpeedRpm', 900);

      mount(a.feed, [long]);
      tick(5);
      mount(b.feed, [capped]);
      tick(MAX_FRAME_DT_S);

      expect(angleAbout(node(long, 'FanBlade'), 'y')).toBeCloseTo(
        angleAbout(node(capped, 'FanBlade'), 'y'),
        9,
      );
      expect(angleAbout(node(long, 'FanBlade'), 'y')).toBeCloseTo(
        integrateAngle(0, spinSpeed(900, [0, 1800]), MAX_FRAME_DT_S),
        9,
      );
    });
  });

  describe('the demand-mode canvas', () => {
    it('asks for no frame when everything has settled, however many frames come', () => {
      const tower = instanceOf('CT-01', [VALVE, SWITCH]);
      const { set, feed } = createRig(['CT-01|valveOpenPct', 'CT-01|switchPct']);
      mount(feed, [tower]);
      set('CT-01|valveOpenPct', 50);
      set('CT-01|switchPct', 50);

      ticks(30);

      expect(invalidate).not.toHaveBeenCalled();
    });

    it('asks for a frame while a value is easing, and stops once it has arrived', () => {
      const tower = instanceOf('CT-01', [VALVE]);
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);
      set('CT-01|valveOpenPct', 50);
      tick();
      expect(invalidate).not.toHaveBeenCalled();

      set('CT-01|valveOpenPct', 60);
      ticks(3);
      expect(invalidate).toHaveBeenCalledTimes(3);

      ticks(120);
      invalidate.mockClear();
      ticks(10);
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe('what is not watched', () => {
    it('leaves the parts that have no reading at rest while the ones that have move', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig([
        'CT-01|fanSpeedRpm',
        'CT-01|valveOpenPct',
        'CT-01|switchPct',
      ]);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);

      ticks(10);

      expect(angleAbout(node(tower, 'FanBlade'), 'y')).not.toBe(0);
      expect(node(tower, 'Valve').quaternion.angleTo(new Quaternion())).toBe(0);
      expect(node(tower, 'Switch').quaternion.angleTo(new Quaternion())).toBe(0);
    });

    it('moves a part when its first reading arrives, straight to the pose', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);
      ticks(5);

      set('CT-01|valveOpenPct', 80);
      tick();

      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeCloseTo((72 * Math.PI) / 180, 9);
    });

    it('has no slot for a part the layout does not hold, and leaves it at rest', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { feed } = createRig(['CT-99|fanSpeedRpm']);
      mount(feed, [tower]);

      ticks(5);

      expect(angleAbout(node(tower, 'FanBlade'), 'y')).toBe(0);
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe('a stale or offline asset', () => {
    it.each([
      ['stale', STALE],
      ['offline', OFFLINE],
    ])('freezes a %s asset at its last pose and asks for no frame', (_name, flags) => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed, rig } = createRig(['CT-01|valveOpenPct', 'CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|valveOpenPct', 50);
      set('CT-01|fanSpeedRpm', 900);
      ticks(10);
      const valve = angleAbout(node(tower, 'Valve'), 'x');
      const fan = angleAbout(node(tower, 'FanBlade'), 'y');

      rig.flags.set('CT-01', flags);
      set('CT-01|valveOpenPct', 100);
      set('CT-01|fanSpeedRpm', 1800);
      invalidate.mockClear();
      ticks(20);

      expect(angleAbout(node(tower, 'Valve'), 'x')).toBe(valve);
      expect(angleAbout(node(tower, 'FanBlade'), 'y')).toBe(fan);
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('moves again once the asset is live', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed, rig } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);
      ticks(5);
      rig.flags.set('CT-01', STALE);
      ticks(5);
      const frozen = angleAbout(node(tower, 'FanBlade'), 'y');

      rig.flags.set('CT-01', LIVE);
      ticks(5);

      expect(angleAbout(node(tower, 'FanBlade'), 'y')).not.toBe(frozen);
    });

    it('freezes only the asset that went stale', () => {
      const one = instanceOf('CT-01', TOWER);
      const two = instanceOf('CT-02', TOWER);
      const { set, feed, rig } = createRig(['CT-01|fanSpeedRpm', 'CT-02|fanSpeedRpm']);
      mount(feed, [one, two]);
      set('CT-01|fanSpeedRpm', 900);
      set('CT-02|fanSpeedRpm', 900);
      ticks(5);
      rig.flags.set('CT-01', STALE);
      const frozen = angleAbout(node(one, 'FanBlade'), 'y');
      const moving = angleAbout(node(two, 'FanBlade'), 'y');

      ticks(5);

      expect(angleAbout(node(one, 'FanBlade'), 'y')).toBe(frozen);
      expect(angleAbout(node(two, 'FanBlade'), 'y')).not.toBe(moving);
    });
  });

  describe('slots', () => {
    it('are looked up once per layout, not every frame', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed, rig } = createRig(['CT-01|fanSpeedRpm', 'CT-01|valveOpenPct']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);

      ticks(20);
      // Three moving bindings in the model (FAN, VALVE, SWITCH): the tint is not looked up.
      expect(rig.slotOf).toHaveBeenCalledTimes(3);

      rig.layout = 2;
      ticks(5);
      expect(rig.slotOf).toHaveBeenCalledTimes(6);
    });

    it('are looked up again for new instances', () => {
      const first = instanceOf('CT-01', TOWER);
      const { feed, rig } = createRig(['CT-01|fanSpeedRpm']);
      const view = mount(feed, [first]);
      ticks(2);
      expect(rig.slotOf).toHaveBeenCalledTimes(3);

      view.rerender({ instances: [instanceOf('CT-01', TOWER)] });
      ticks(2);

      expect(rig.slotOf).toHaveBeenCalledTimes(6);
    });

    it('follow a layout that moves a key to another place in the buffer', () => {
      const tower = instanceOf('CT-01', [VALVE]);
      const first = createRig(['CT-01|valveOpenPct', 'CT-02|valveOpenPct']);
      const { feed, rig } = first;
      mount(feed, [tower]);
      first.set('CT-01|valveOpenPct', 50);
      tick();
      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeCloseTo(Math.PI / 4, 9);

      // A new layout: this key is now second, and the buffer holds 100 there.
      rig.slotOf.mockImplementation((code: string) => (code === 'CT-01' ? 1 : -1));
      rig.targets = Float32Array.from([10, 100]);
      rig.layout = 2;
      tick();

      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeGreaterThan(Math.PI / 4);
    });
  });

  describe('the first value', () => {
    it('snaps for instances made later, however far it is from the authored pose', () => {
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      const view = mount(feed, [instanceOf('CT-01', TOWER)]);
      set('CT-01|valveOpenPct', 40);
      ticks(5);

      const later = instanceOf('CT-01', TOWER);
      view.rerender({ instances: [later] });
      tick();

      expect(angleAbout(node(later, 'Valve'), 'x')).toBeCloseTo((36 * Math.PI) / 180, 9);
    });

    it('snaps the first value after the telemetry socket comes back, and eases otherwise', () => {
      setSocket('live');
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);
      set('CT-01|valveOpenPct', 50);
      tick();

      set('CT-01|valveOpenPct', 60);
      tick();
      const eased = angleAbout(node(tower, 'Valve'), 'x');
      expect(eased).toBeLessThan((54 * Math.PI) / 180);

      setSocket('reconnecting');
      setSocket('live');
      set('CT-01|valveOpenPct', 70);
      tick();

      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeCloseTo((63 * Math.PI) / 180, 9);
    });

    it('does not snap on a socket that was live all along', () => {
      setSocket('live');
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|valveOpenPct']);
      mount(feed, [tower]);
      set('CT-01|valveOpenPct', 50);
      tick();

      setSocket('live');
      set('CT-01|valveOpenPct', 60);
      tick();

      expect(angleAbout(node(tower, 'Valve'), 'x')).toBeLessThan((54 * Math.PI) / 180);
    });
  });

  describe('what it ignores', () => {
    it('does nothing without a feed', () => {
      const tower = instanceOf('CT-01', TOWER);
      mount(null, [tower]);

      expect(() => ticks(5)).not.toThrow();

      expect(angleAbout(node(tower, 'FanBlade'), 'y')).toBe(0);
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('does nothing without instances', () => {
      const { feed, rig } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, []);

      ticks(5);

      expect(rig.slotOf).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('skips a node the model does not have, and moves the others', () => {
      const tower = instanceOf('CT-01', [
        binding('Nope', 'valveOpenPct', 'turn', NUMBER_0_100, 'x', [0, 90]),
        FAN,
      ]);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);

      expect(() => ticks(5)).not.toThrow();

      expect(angleAbout(node(tower, 'FanBlade'), 'y')).not.toBe(0);
    });

    it('never moves a tint', () => {
      const tower = instanceOf('CT-01', [MOTOR]);
      const { set, feed } = createRig(['CT-01|motorTempC']);
      mount(feed, [tower]);
      set('CT-01|motorTempC', 90);

      ticks(5);

      const motor = node(tower, 'FanMotor');
      expect(motor.quaternion.angleTo(new Quaternion())).toBe(0);
      expect(motor.position.toArray()).toEqual([0, 0, 0]);
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('keeps one asset’s readings off another asset’s parts', () => {
      const one = instanceOf('CT-01', TOWER);
      const two = instanceOf('CT-02', TOWER);
      const { set, feed } = createRig(['CT-01|valveOpenPct', 'CT-02|valveOpenPct']);
      mount(feed, [one, two]);
      set('CT-01|valveOpenPct', 100);
      set('CT-02|valveOpenPct', 0);

      tick();

      expect(angleAbout(node(one, 'Valve'), 'x')).toBeCloseTo(Math.PI / 2, 9);
      expect(angleAbout(node(two, 'Valve'), 'x')).toBeCloseTo(0, 9);
    });
  });

  describe('frame demand (V2-19.2)', () => {
    it('runs below priority 0, so FrameDriver reads its flag in the same frame', () => {
      mount(createRig(['CT-01|fanSpeedRpm']).feed, [instanceOf('CT-01', TOWER)]);

      expect(frame.priority).toBeLessThan(0);
    });

    it('reports bound while a spin lasts, and not once it has stopped', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);

      tick();
      expect(demand.bound).toBe(true);

      set('CT-01|fanSpeedRpm', 0);
      ticks(120);
      expect(demand.bound).toBe(false);
    });

    it('never asks R3F for a frame itself', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm']);
      mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);

      ticks(30);

      expect(hookInvalidate).not.toHaveBeenCalled();
    });

    it('reports nothing with no feed, and puts a flag that was up back down', () => {
      mount(null, [instanceOf('CT-01', TOWER)]);
      demand.bound = true;

      tick();

      expect(demand.bound).toBe(false);
    });

    it('reports nothing with no parts to move', () => {
      mount(createRig([]).feed, []);
      demand.bound = true;

      tick();

      expect(demand.bound).toBe(false);
    });

    it('puts its flag down when it goes away, so the driver does not draw for a loop that is gone', () => {
      const tower = instanceOf('CT-01', TOWER);
      const { set, feed } = createRig(['CT-01|fanSpeedRpm']);
      const { unmount } = mount(feed, [tower]);
      set('CT-01|fanSpeedRpm', 900);
      tick();
      expect(demand.bound).toBe(true);

      unmount();

      expect(demand.bound).toBe(false);
    });
  });
});
