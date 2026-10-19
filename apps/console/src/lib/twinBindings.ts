import type { TelemetryPoint } from '@occ/contracts';

/*
 * The bindings of a modelled asset class, read from the `extras` of its glTF nodes (V2-14.2). The console
 * builds them from the model, so a new class needs a model and catalogue rows, not code (ADR-0020 § Model
 * contract); this replaces the hand-written copy in `assetParts.ts`, which V2-14.10 deletes. Pure: no
 * `three`, no DOM. The scene (V2-14.7, V2-14.8) and the inspector (V2-14.10) feed it descriptors, built
 * from an `Object3D` or from a GLB's JSON.
 *
 * `pnpm models:check` (`ops/model-tools/rules.ts`) holds a delivered file to the same rules, and this
 * module mirrors them. It is the second line of defence for a model that did not go through that check (a
 * deployment's own directory, a newer catalogue): a node it cannot use is dropped and reported as a
 * `Problem`, never thrown, so one bad part does not take the scene down. What a binding does to a part
 * (the encoding, the easing, the tint) is ADR-0020 § State "Settled in V2-14.1", and V2-14.3 / V2-14.8.
 */

export type Motion = 'spin' | 'turn' | 'slide' | 'tint';
export type Axis = 'x' | 'y' | 'z';

/** A node of the model as plain data. `extras` is whatever the file holds, so it is checked, not trusted. */
export interface NodeInfo {
  name: string;
  extras?: unknown;
  children?: readonly NodeInfo[];
}

/** What the motion maths needs of the bound point: its kind, and the domain a value is mapped from. */
export type BindingPoint = Pick<TelemetryPoint, 'kind' | 'min' | 'max' | 'enumValues'>;

export interface Binding {
  /** The node's name: unique in the model, and how the scene finds it. */
  node: string;
  /** The `key` of the point the node follows. */
  key: string;
  motion: Motion;
  /** `spin`, `turn` and `slide` only. */
  axis?: Axis;
  /** `spin`, `turn` and `slide` only: `min < max`, the pose or speed the point's domain is mapped onto. */
  range?: [number, number];
  point: BindingPoint;
  /** The word the Parts row shows, when the model gives one. */
  label?: string;
  /** The nearest part above this one, `null` under the root. */
  parent: string | null;
}

export type ProblemReason =
  /** `bind` is not text. */
  | 'bad-extras'
  /** `bind` is not a key of the class's points. */
  | 'unknown-key'
  | 'unknown-motion'
  /** A moving motion without `x`, `y` or `z`. */
  | 'missing-axis'
  /** A moving motion whose `range` is absent, not two finite numbers, or not `min < max`. */
  | 'missing-range'
  /** A bound node with no name, which the scene cannot find. */
  | 'unnamed'
  /** The name is already taken by an earlier node: the first one stays. */
  | 'duplicate-name'
  /** `turn` or `slide` on a point whose domain is open (a number without `min` and `max`, an enum without values). */
  | 'no-domain'
  /** `spin` on a point that is not a number. */
  | 'kind-mismatch';

export interface Problem {
  /** The node's name; `''` for an unnamed one. */
  node: string;
  reason: ProblemReason;
  /** One line for the log. Tests match `reason`, never this. */
  detail: string;
}

export interface PartNode {
  name: string;
  /** The nearest part above, `null` under the root. */
  parent: string | null;
}

const MOTIONS: readonly string[] = ['spin', 'turn', 'slide', 'tint'];
const AXES: readonly string[] = ['x', 'y', 'z'];

const isMotion = (value: unknown): value is Motion =>
  typeof value === 'string' && MOTIONS.includes(value);
const isAxis = (value: unknown): value is Axis => typeof value === 'string' && AXES.includes(value);
const isMoving = (motion: Motion): boolean => motion !== 'tint';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasTextKey = (value: unknown): boolean => isRecord(value) && typeof value.key === 'string';

/** `[min, max]` of two finite numbers with `min < max`, else `null`. */
function readRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [min, max] = value as unknown[];
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  return [min, max];
}

/** A node as the walk meets it. Only a `kept` node is a part. */
interface Walked {
  node: NodeInfo;
  name: string;
  parent: string | null;
  status: 'kept' | 'unnamed' | 'duplicate';
}

/**
 * Every node below the root, depth first in document order, the root left out. Both outputs read this one
 * walk, so the tree and the bindings cannot disagree about which nodes exist.
 *
 * A `_` helper (a pivot group) is not a part and is not reported, but its children are walked: the helper
 * exists to hold a pivot for the part inside it. An unnamed node and a later node with a name already seen
 * are not parts either (the first of a name stays, as `getObjectByName` would find it), and are kept in the
 * list so they can be reported; their children are walked too and hang from the nearest part above.
 */
function walk(root: NodeInfo): Walked[] {
  const walked: Walked[] = [];
  const names = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (children: unknown, parent: string | null): void => {
    if (!Array.isArray(children)) return;
    for (const child of children as unknown[]) {
      // A cycle cannot come from a file or a scene graph, but a shared node would otherwise loop forever.
      if (!isRecord(child) || visited.has(child)) continue;
      visited.add(child);
      const node = child as unknown as NodeInfo;
      const name = typeof node.name === 'string' ? node.name : '';

      if (name.startsWith('_')) {
        visit(node.children, parent);
        continue;
      }
      const status = name === '' ? 'unnamed' : names.has(name) ? 'duplicate' : 'kept';
      walked.push({ node, name, parent, status });
      if (status === 'kept') names.add(name);
      visit(node.children, status === 'kept' ? name : parent);
    }
  };
  if (isRecord(root)) {
    visited.add(root);
    visit(root.children, null);
  }
  return walked;
}

/** The named parts of the model with the part each one hangs from, children straight after their parent. */
export function partTree(root: NodeInfo): PartNode[] {
  return walk(root)
    .filter(({ status }) => status === 'kept')
    .map(({ name, parent }) => ({ name, parent }));
}

/**
 * Why `motion` cannot place a value of `point`, or `null` when it can. `spin` follows a number. `turn` and
 * `slide` map the point's domain onto `range` (ADR-0020 § State): a number needs both bounds, an enum its
 * values, a boolean nothing. `tint` shows alarm, not value, so it asks nothing of the point.
 */
function pointProblem(motion: Motion, point: TelemetryPoint): Problem['reason'] | null {
  if (motion === 'tint') return null;
  if (motion === 'spin') return point.kind === 'number' ? null : 'kind-mismatch';
  if (point.kind === 'boolean') return null;
  if (point.kind === 'enum') {
    return Array.isArray(point.enumValues) && point.enumValues.length > 0 ? null : 'no-domain';
  }
  const { min, max } = point;
  const bounded = typeof min === 'number' && typeof max === 'number' && min < max;
  return point.kind === 'number' && bounded ? null : 'no-domain';
}

/**
 * The bindings of a model, and the nodes that could not be bound. A node without `extras.bind` is a static
 * part (nothing to bind, nothing to report). A node with one is checked in a fixed order and, if it fails,
 * gives the first problem only and is dropped; the others are unaffected. `root` is the class root
 * (`CoolingTower`), not its `_LOD1` sibling, and is not itself a part.
 */
export function bindingsFromNodes(
  root: NodeInfo,
  points: readonly TelemetryPoint[],
): { bindings: Binding[]; problems: Problem[] } {
  const bindings: Binding[] = [];
  const problems: Problem[] = [];
  const byKey = new Map<string, TelemetryPoint>();
  for (const point of Array.isArray(points) ? points : []) {
    // Not a type guard: `point` keeps its type, while a catalogue entry that is not an object or has no
    // text key (the type says it cannot happen; the data comes from elsewhere) is skipped, not thrown on.
    if (hasTextKey(point) && !byKey.has(point.key)) byKey.set(point.key, point);
  }

  for (const { node, name, parent, status } of walk(root)) {
    const problem = (reason: ProblemReason, detail: string): void => {
      problems.push({ node: name, reason, detail });
    };

    if (status === 'duplicate') {
      problem('duplicate-name', `${JSON.stringify(name)} is already the name of an earlier node`);
      continue;
    }
    const extras = isRecord(node.extras) ? node.extras : null;
    if (extras === null || extras.bind === undefined) continue;
    if (status === 'unnamed') {
      problem('unnamed', 'a bound node has no name, so the scene cannot find it');
      continue;
    }

    const { bind, motion } = extras;
    if (typeof bind !== 'string') {
      problem('bad-extras', `bind is ${JSON.stringify(bind)}, not text`);
      continue;
    }
    const point = byKey.get(bind);
    if (point === undefined) {
      problem('unknown-key', `${JSON.stringify(bind)} is not a point of the class`);
      continue;
    }
    if (!isMotion(motion)) {
      problem(
        'unknown-motion',
        `motion ${JSON.stringify(motion)} is not one of ${MOTIONS.join(', ')}`,
      );
      continue;
    }

    let axis: Axis | undefined;
    let range: [number, number] | undefined;
    if (isMoving(motion)) {
      if (!isAxis(extras.axis)) {
        problem('missing-axis', `${motion} needs an axis, one of ${AXES.join(', ')}`);
        continue;
      }
      axis = extras.axis;
      const read = readRange(extras.range);
      if (read === null) {
        problem(
          'missing-range',
          `${motion} needs a range [min, max] of finite numbers with min < max`,
        );
        continue;
      }
      range = read;
    }
    const reason = pointProblem(motion, point);
    if (reason !== null) {
      problem(reason, `${motion} cannot follow ${bind}, a ${point.kind} point`);
      continue;
    }

    const binding: Binding = {
      node: name,
      key: bind,
      motion,
      point: {
        kind: point.kind,
        min: point.min,
        max: point.max,
        enumValues: Array.isArray(point.enumValues) ? [...point.enumValues] : null,
      },
      parent,
    };
    if (axis !== undefined && range !== undefined) {
      binding.axis = axis;
      binding.range = range;
    }
    if (typeof extras.label === 'string' && extras.label.trim() !== '')
      binding.label = extras.label;
    bindings.push(binding);
  }
  return { bindings, problems };
}
