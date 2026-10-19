import type { TelemetryPoint } from '@occ/contracts';
// `?raw` (typed by `vite/client`): the files' text, with no `node:fs` and no `@types/node`. The paths are
// from `apps/console/src/lib` to the repo root, as in `modelParts.test.ts`.
import assetClassesText from '../../../../docs/design/v2/asset-classes.md?raw';
import catalogueText from '../../../../ops/telemetry-sim/catalogue.json?raw';
import {
  type Binding,
  bindingsFromNodes,
  type NodeInfo,
  type PartNode,
  partTree,
  type Problem,
  type ProblemReason,
} from './twinBindings';

/*
 * The oracle (V2-14.2, AC1) is asset-classes.md: the "Bound part" column of each modelled class's
 * telemetry-points table gives the node, motion, axis and range, and § Parts of an asset the label. The
 * points' domains come from the simulator's copy of the seeded catalogue, which the API's
 * `telemetry-sim-catalogue.spec.ts` keeps equal to the seed. A change to the doc's tables or to a point
 * therefore fails here, instead of leaving a model that binds something the catalogue no longer has.
 */

const MODELLED = ['cooling_tower', 'standby_generator'] as const;
type ClassCode = (typeof MODELLED)[number];

// --- reading the doc ---------------------------------------------------------------------------------------

const DOC_LINES = assetClassesText.split('\n');

/** The lines under the first heading (any level) that satisfies `isHeading`, up to the next heading. */
function sectionOf(isHeading: (line: string) => boolean, what: string): string[] {
  const start = DOC_LINES.findIndex(isHeading);
  if (start < 0) throw new Error(`asset-classes.md has no heading for ${what}`);
  const end = DOC_LINES.findIndex((line, index) => index > start && /^#{1,3} /.test(line));
  return DOC_LINES.slice(start + 1, end < 0 ? undefined : end);
}

const cellsOf = (line: string): string[] =>
  line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
const unquote = (cell: string): string => cell.replace(/^`|`$/g, '');

/** The first table under the lines, as rows of cells, without the separator row. */
function firstTable(lines: string[]): string[][] {
  const start = lines.findIndex((line) => line.startsWith('|'));
  if (start < 0) throw new Error('asset-classes.md: a section has no table where one is expected');
  const rows: string[][] = [];
  for (const line of lines.slice(start)) {
    if (!line.startsWith('|')) break;
    const cells = cellsOf(line);
    if (!cells.every((cell) => /^-+$/.test(cell))) rows.push(cells);
  }
  return rows;
}

interface DocBinding {
  classCode: ClassCode;
  node: string;
  key: string;
  /** The `kind` column of the doc's row, checked against the catalogue. */
  kind: string;
  motion: string;
  axis?: string;
  range?: [number, number];
  label: string;
}

/** The labels of § Parts of an asset, by `class:node`. */
function docLabels(): Map<string, string> {
  const rows = firstTable(
    sectionOf((line) => line.startsWith('### Parts of an asset'), '§ Parts of an asset'),
  );
  return new Map(
    rows
      .filter((row) => row.length === 5 && row[0]?.startsWith('`'))
      .map((row): [string, string] => [
        `${unquote(row[0] ?? '')}:${unquote(row[1] ?? '')}`,
        row[2] ?? '',
      ]),
  );
}

function docBindings(classCode: ClassCode, labels: Map<string, string>): DocBinding[] {
  const [header = [], ...rows] = firstTable(
    sectionOf(
      (line) => line.startsWith('### ') && line.includes(`(\`${classCode}\`, modelled)`),
      classCode,
    ),
  );
  const keyAt = header.indexOf('`key`');
  const kindAt = header.indexOf('`kind`');
  const boundAt = header.indexOf('Bound part');
  if ([keyAt, kindAt, boundAt].includes(-1))
    throw new Error(`${classCode}: the table changed shape`);

  const found: DocBinding[] = [];
  for (const row of rows) {
    const bound = row[boundAt] ?? '';
    if (bound === 'none') continue;
    // `FanBlade` · spin · y · [0, 1800]   or   `FanMotor` · tint
    const [nodeCell = '', motion = '', axis, range] = bound.split(' · ').map((part) => part.trim());
    found.push({
      classCode,
      node: unquote(nodeCell),
      key: unquote(row[keyAt] ?? ''),
      kind: row[kindAt] ?? '',
      motion,
      ...(axis === undefined ? {} : { axis }),
      ...(range === undefined ? {} : { range: JSON.parse(range) as [number, number] }),
      label: labels.get(`${classCode}:${unquote(nodeCell)}`) ?? '',
    });
  }
  return found;
}

// --- the catalogue's points --------------------------------------------------------------------------------

interface SimPoint {
  key: string;
  kind: TelemetryPoint['kind'];
  min: number | null;
  max: number | null;
  enumValues: string[] | null;
}
const CATALOGUE = JSON.parse(catalogueText) as {
  assets: { classCode: string; points: SimPoint[] }[];
};

/** The class's points as `TelemetryPoint`s: the fields the module reads from the catalogue, the rest fixed. */
function pointsOf(classCode: ClassCode): TelemetryPoint[] {
  const asset = CATALOGUE.assets.find((candidate) => candidate.classCode === classCode);
  if (asset === undefined) throw new Error(`catalogue.json has no asset of ${classCode}`);
  return asset.points.map(({ key, kind, min, max, enumValues }) => ({
    key,
    kind,
    min,
    max,
    enumValues,
    label: key,
    unit: null,
    expectedIntervalS: 1,
    headline: null,
  }));
}

const pointOf = (points: TelemetryPoint[], key: string): TelemetryPoint => {
  const found = points.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`the catalogue has no point ${key}`);
  return found;
};

// --- helpers for descriptors -------------------------------------------------------------------------------

const node = (name: string, extras?: unknown, children?: NodeInfo[]): NodeInfo => ({
  name,
  ...(extras === undefined ? {} : { extras }),
  ...(children === undefined ? {} : { children }),
});

const extrasOf = (bound: DocBinding): Record<string, unknown> => ({
  bind: bound.key,
  motion: bound.motion,
  ...(bound.axis === undefined ? {} : { axis: bound.axis, range: bound.range }),
  label: bound.label,
});

const reasons = (problems: Problem[]): { node: string; reason: ProblemReason }[] =>
  problems.map(({ node: name, reason }) => ({ node: name, reason }));
const names = (bindings: Binding[]): string[] => bindings.map((binding) => binding.node);

const point = (
  overrides: Partial<TelemetryPoint> & Pick<TelemetryPoint, 'key'>,
): TelemetryPoint => ({
  label: overrides.key,
  unit: null,
  kind: 'number',
  min: 0,
  max: 100,
  enumValues: null,
  expectedIntervalS: 1,
  headline: null,
  ...overrides,
});

/** A small class for the cases that are not about the doc. */
const POINTS: TelemetryPoint[] = [
  point({ key: 'speed', min: 0, max: 1800 }),
  point({ key: 'level' }),
  point({ key: 'hours', min: 0, max: null }),
  point({ key: 'flag', kind: 'boolean', min: null, max: null }),
  point({ key: 'mode', kind: 'enum', min: null, max: null, enumValues: ['off', 'auto', 'hand'] }),
  point({ key: 'noValues', kind: 'enum', min: null, max: null, enumValues: null }),
  point({ key: 'emptyValues', kind: 'enum', min: null, max: null, enumValues: [] }),
  point({ key: 'inverted', min: 10, max: 10 }),
];

const SPIN = { bind: 'speed', motion: 'spin', axis: 'y', range: [0, 1800] };
const TINT = { bind: 'level', motion: 'tint' };

/** One bad node between two good ones, as a model with a mistake in it looks. */
const withBad = (extras: unknown, name = 'Bad'): NodeInfo =>
  node('Root', undefined, [node('Fan', SPIN), node(name, extras), node('Motor', TINT)]);

// --- AC1: the doc is the oracle ----------------------------------------------------------------------------

describe('bindings against asset-classes.md', () => {
  const labels = docLabels();

  it.each([
    ['cooling_tower', 5],
    ['standby_generator', 7],
  ] as const)(
    'finds the bound parts of %s in the doc (%i), so the oracle is not vacuous',
    (classCode, count) => {
      const found = docBindings(classCode, labels);

      expect(found).toHaveLength(count);
      for (const bound of found) {
        expect(bound.label, `${classCode} ${bound.node} has a row in § Parts of an asset`).not.toBe(
          '',
        );
      }
    },
  );

  it.each(MODELLED)(
    'reads %s as the doc lists it, one binding for each bound part',
    (classCode) => {
      const found = docBindings(classCode, labels);
      const points = pointsOf(classCode);
      const root = node(
        'Root',
        undefined,
        found.map((bound) => node(bound.node, extrasOf(bound))),
      );

      const { bindings, problems } = bindingsFromNodes(root, points);

      expect(problems).toEqual([]);
      expect(bindings).toEqual(
        found.map((bound) => {
          const { kind, min, max, enumValues } = pointOf(points, bound.key);
          return {
            node: bound.node,
            key: bound.key,
            motion: bound.motion,
            ...(bound.axis === undefined ? {} : { axis: bound.axis, range: bound.range }),
            point: { kind, min, max, enumValues },
            label: bound.label,
            parent: null,
          };
        }),
      );
    },
  );

  it.each(MODELLED)(
    'has the same point kinds in the doc and the catalogue, for %s',
    (classCode) => {
      const points = pointsOf(classCode);
      for (const bound of docBindings(classCode, labels)) {
        expect(pointOf(points, bound.key).kind, `${classCode} ${bound.key}`).toBe(bound.kind);
      }
    },
  );

  it('gives the doc’s ranges: Switch ±35, Valve 0–90, Breaker 0–35, the fans 0–1800', () => {
    const all = MODELLED.flatMap((classCode) => docBindings(classCode, labels));
    const range = (name: string) => all.find((bound) => bound.node === name)?.range;

    expect(range('Switch')).toEqual([-35, 35]);
    expect(range('Valve')).toEqual([0, 90]);
    expect(range('Breaker')).toEqual([0, 35]);
    expect(range('FanBlade')).toEqual([0, 1800]);
    expect(range('RadiatorFan')).toEqual([0, 1800]);
  });
});

// --- AC2: what goes wrong gives a Problem, and the rest still works -----------------------------------------

describe('a node that cannot be bound', () => {
  const CASES: [ProblemReason, string, unknown][] = [
    ['unknown-key', 'a key that is not a point', { bind: 'nope', motion: 'tint' }],
    ['unknown-motion', 'a motion that is not one of four', { bind: 'speed', motion: 'wobble' }],
    ['unknown-motion', 'no motion', { bind: 'speed' }],
    ['missing-axis', 'no axis', { bind: 'speed', motion: 'spin', range: [0, 1800] }],
    ['missing-axis', 'an axis that is not x, y or z', { ...SPIN, axis: 'w' }],
    ['missing-range', 'no range', { bind: 'speed', motion: 'spin', axis: 'y' }],
    ['missing-range', 'a range of three', { ...SPIN, range: [0, 1, 2] }],
    ['missing-range', 'a range with min equal to max', { ...SPIN, range: [5, 5] }],
    ['missing-range', 'a range with min above max', { ...SPIN, range: [10, 5] }],
    ['missing-range', 'a range that is text', { ...SPIN, range: ['0', '1800'] }],
    ['missing-range', 'a range that is not finite', { ...SPIN, range: [0, Infinity] }],
    ['missing-range', 'a range that is not a list', { ...SPIN, range: 1800 }],
    ['bad-extras', 'a bind that is a number', { bind: 3, motion: 'tint' }],
    ['bad-extras', 'a bind that is null', { bind: null, motion: 'tint' }],
    ['kind-mismatch', 'a spin on a boolean point', { ...SPIN, bind: 'flag' }],
    ['kind-mismatch', 'a spin on an enum point', { ...SPIN, bind: 'mode' }],
    [
      'no-domain',
      'a turn on a number with no max',
      { bind: 'hours', motion: 'turn', axis: 'x', range: [0, 90] },
    ],
    [
      'no-domain',
      'a slide on a number with min equal to max',
      { bind: 'inverted', motion: 'slide', axis: 'x', range: [0, 1] },
    ],
    [
      'no-domain',
      'a turn on an enum with no values',
      { bind: 'noValues', motion: 'turn', axis: 'x', range: [0, 1] },
    ],
    [
      'no-domain',
      'a turn on an enum with an empty list',
      { bind: 'emptyValues', motion: 'turn', axis: 'x', range: [0, 1] },
    ],
  ];

  it.each(CASES)('gives %s for %s, and the other bindings still work', (reason, _what, extras) => {
    const { bindings, problems } = bindingsFromNodes(withBad(extras), POINTS);

    expect(reasons(problems)).toEqual([{ node: 'Bad', reason }]);
    expect(names(bindings)).toEqual(['Fan', 'Motor']);
    expect(problems[0]?.detail).toEqual(expect.any(String));
  });

  it('gives the first problem only when several apply', () => {
    const { problems } = bindingsFromNodes(
      withBad({ bind: 'nope', motion: 'wobble', range: 'x' }),
      POINTS,
    );

    expect(reasons(problems)).toEqual([{ node: 'Bad', reason: 'unknown-key' }]);
  });

  it('binds a turn and a slide on a boolean, a bounded number and an enum with values', () => {
    const root = node('Root', undefined, [
      node('Door', { bind: 'flag', motion: 'turn', axis: 'x', range: [0, 35] }),
      node('Valve', { bind: 'level', motion: 'slide', axis: 'z', range: [0, 1] }),
      node('Switch', { bind: 'mode', motion: 'turn', axis: 'x', range: [-35, 35] }),
    ]);

    const { bindings, problems } = bindingsFromNodes(root, POINTS);

    expect(problems).toEqual([]);
    expect(names(bindings)).toEqual(['Door', 'Valve', 'Switch']);
  });

  it('reports a duplicate name, keeps the first node, and keeps the rest working', () => {
    const root = node('Root', undefined, [
      node('Fan', SPIN),
      node('Motor', TINT),
      node('Fan', { bind: 'level', motion: 'tint' }),
      node('Casing'),
      node('Casing'),
    ]);

    const { bindings, problems } = bindingsFromNodes(root, POINTS);

    expect(reasons(problems)).toEqual([
      { node: 'Fan', reason: 'duplicate-name' },
      { node: 'Casing', reason: 'duplicate-name' },
    ]);
    expect(bindings.map(({ node: name, key }) => [name, key])).toEqual([
      ['Fan', 'speed'],
      ['Motor', 'level'],
    ]);
    expect(partTree(root).map(({ name }) => name)).toEqual(['Fan', 'Motor', 'Casing']);
  });

  it('reports a bound node with no name, and ignores an unnamed static one', () => {
    const root = node('Root', undefined, [
      node('', TINT),
      node('', { note: 'x' }),
      { name: undefined as unknown as string, extras: undefined },
      node('Fan', SPIN),
    ]);

    const { bindings, problems } = bindingsFromNodes(root, POINTS);

    expect(reasons(problems)).toEqual([{ node: '', reason: 'unnamed' }]);
    expect(names(bindings)).toEqual(['Fan']);
    expect(partTree(root)).toEqual([{ name: 'Fan', parent: null }]);
  });
});

// --- the tree -----------------------------------------------------------------------------------------------

describe('the parts of a model', () => {
  const labels = docLabels();
  const bound = (classCode: ClassCode, name: string): NodeInfo => {
    const found = docBindings(classCode, labels).find((candidate) => candidate.node === name);
    if (found === undefined) throw new Error(`${classCode} has no bound part ${name}`);
    return node(name, extrasOf(found));
  };

  /** The brief's cooling tower tree: static parts are bare nodes, bound ones carry the doc's `extras`. */
  const tower = (): NodeInfo =>
    node('CoolingTower', undefined, [
      node('Casing'),
      node('FanStack', undefined, [bound('cooling_tower', 'FanBlade')]),
      bound('cooling_tower', 'FanMotor'),
      bound('cooling_tower', 'Pump'),
      bound('cooling_tower', 'Valve'),
      node('Pipe'),
      node('Riser'),
      node('ControlPanel', undefined, [bound('cooling_tower', 'Switch')]),
    ]);

  it('lists the named nodes with their parent, children straight after it, the root left out', () => {
    expect(partTree(tower())).toEqual<PartNode[]>([
      { name: 'Casing', parent: null },
      { name: 'FanStack', parent: null },
      { name: 'FanBlade', parent: 'FanStack' },
      { name: 'FanMotor', parent: null },
      { name: 'Pump', parent: null },
      { name: 'Valve', parent: null },
      { name: 'Pipe', parent: null },
      { name: 'Riser', parent: null },
      { name: 'ControlPanel', parent: null },
      { name: 'Switch', parent: 'ControlPanel' },
    ]);
  });

  it('gives each binding the part it hangs from', () => {
    const { bindings, problems } = bindingsFromNodes(tower(), pointsOf('cooling_tower'));

    expect(problems).toEqual([]);
    expect(bindings.map(({ node: name, parent }) => [name, parent])).toEqual([
      ['FanBlade', 'FanStack'],
      ['FanMotor', null],
      ['Pump', null],
      ['Valve', null],
      ['Switch', 'ControlPanel'],
    ]);
  });

  it('lists a bound parent and its bound child on the generator', () => {
    const root = node('StandbyGenerator', undefined, [
      node('Radiator', undefined, [bound('standby_generator', 'RadiatorFan')]),
      {
        ...bound('standby_generator', 'ControlPanel'),
        children: [bound('standby_generator', 'Breaker')],
      },
    ]);

    const { bindings, problems } = bindingsFromNodes(root, pointsOf('standby_generator'));

    expect(problems).toEqual([]);
    expect(bindings.map(({ node: name, parent }) => [name, parent])).toEqual([
      ['RadiatorFan', 'Radiator'],
      ['ControlPanel', null],
      ['Breaker', 'ControlPanel'],
    ]);
  });

  it('skips a `_` helper but keeps what is inside it, hanging from the part above', () => {
    const root = node('CoolingTower', undefined, [
      node('FanStack', undefined, [
        node('_FanPivot', undefined, [bound('cooling_tower', 'FanBlade')]),
      ]),
      node('_Helper', { bind: 'nope', motion: 'tint' }),
    ]);

    const { bindings, problems } = bindingsFromNodes(root, pointsOf('cooling_tower'));

    expect(problems).toEqual([]);
    expect(bindings.map(({ node: name, parent }) => [name, parent])).toEqual([
      ['FanBlade', 'FanStack'],
    ]);
    expect(partTree(root)).toEqual([
      { name: 'FanStack', parent: null },
      { name: 'FanBlade', parent: 'FanStack' },
    ]);
  });

  it('keeps the children of a dropped duplicate, hanging from the part above', () => {
    const root = node('CoolingTower', undefined, [
      node('Pump', undefined, [node('Inlet')]),
      node('Pump', undefined, [bound('cooling_tower', 'Valve')]),
    ]);

    const { bindings, problems } = bindingsFromNodes(root, pointsOf('cooling_tower'));

    expect(reasons(problems)).toEqual([{ node: 'Pump', reason: 'duplicate-name' }]);
    expect(bindings.map(({ node: name, parent }) => [name, parent])).toEqual([['Valve', null]]);
    expect(partTree(root).map(({ name }) => name)).toEqual(['Pump', 'Inlet', 'Valve']);
  });

  it('has no parts for a model with no children', () => {
    expect(partTree(node('Root'))).toEqual([]);
    expect(bindingsFromNodes(node('Root'), POINTS)).toEqual({ bindings: [], problems: [] });
  });
});

// --- tolerance ----------------------------------------------------------------------------------------------

describe('what the module tolerates', () => {
  it('drops the axis and range of a tint, with no problem', () => {
    const { bindings, problems } = bindingsFromNodes(
      node('Root', undefined, [node('Motor', { ...TINT, axis: 'y', range: [0, 1] })]),
      POINTS,
    );

    expect(problems).toEqual([]);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).not.toHaveProperty('axis');
    expect(bindings[0]).not.toHaveProperty('range');
  });

  it('treats a node with no bind as a static part, whatever else it carries', () => {
    const root = node('Root', undefined, [
      node('Casing', { label: 'Casing', motion: 'spin', axis: 'q', anything: 1 }),
      node('Pipe', {}),
      node('Riser', null),
    ]);

    expect(bindingsFromNodes(root, POINTS)).toEqual({ bindings: [], problems: [] });
    expect(partTree(root).map(({ name }) => name)).toEqual(['Casing', 'Pipe', 'Riser']);
  });

  it('keeps a label that is text and ignores one that is not', () => {
    const labelOf = (label: unknown) =>
      bindingsFromNodes(node('Root', undefined, [node('Motor', { ...TINT, label })]), POINTS)
        .bindings[0]?.label;

    expect(labelOf('Fan motor')).toBe('Fan motor');
    expect(labelOf('')).toBeUndefined();
    expect(labelOf('   ')).toBeUndefined();
    expect(labelOf(3)).toBeUndefined();
    expect(labelOf(undefined)).toBeUndefined();
  });

  it('copies the range and the point’s list, so a binding cannot change the model or the catalogue', () => {
    const extras = { ...SPIN, range: [0, 1800] };
    const modes = point({
      key: 'mode',
      kind: 'enum',
      min: null,
      max: null,
      enumValues: ['a', 'b'],
    });
    const root = node('Root', undefined, [
      node('Fan', extras),
      node('Switch', { bind: 'mode', motion: 'turn', axis: 'x', range: [-35, 35] }),
    ]);

    const { bindings } = bindingsFromNodes(root, [
      ...POINTS.filter((p) => p.key !== 'mode'),
      modes,
    ]);

    expect(bindings[0]?.range).toEqual([0, 1800]);
    expect(bindings[0]?.range).not.toBe(extras.range);
    expect(bindings[1]?.point.enumValues).toEqual(['a', 'b']);
    expect(bindings[1]?.point.enumValues).not.toBe(modes.enumValues);
  });

  it('takes the first point of a key and never changes its inputs', () => {
    const deepFreeze = <T>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    // Fresh copies: freezing the shared fixtures would leak into the other cases.
    const spin = structuredClone(SPIN);
    const root = deepFreeze(
      node('Root', undefined, [node('Fan', spin), node('Fan', spin), node('Bad', { bind: 'x' })]),
    );
    const points = deepFreeze([
      ...structuredClone(POINTS),
      point({ key: 'speed', min: 0, max: 5 }),
    ]);

    const { bindings } = bindingsFromNodes(root, points);

    expect(bindings[0]?.point.max).toBe(1800);
  });

  it('never throws, whatever the file or the catalogue holds', () => {
    const garbage = [
      null,
      3,
      'x',
      [],
      { name: 5 },
      { name: 'A', extras: null },
      { name: 'B', extras: [] },
      { name: 'C', extras: 'x', children: 'nope' },
      { name: 'D', extras: { bind: {}, motion: [] }, children: [null, undefined, { name: 'E' }] },
    ];

    expect(() =>
      bindingsFromNodes({ name: 'Root', children: garbage } as never, POINTS),
    ).not.toThrow();
    expect(() => partTree({ name: 'Root', children: garbage } as never)).not.toThrow();
    expect(() => bindingsFromNodes(null as never, POINTS)).not.toThrow();
    expect(() => partTree(undefined as never)).not.toThrow();
    expect(() =>
      bindingsFromNodes(node('Root', undefined, [node('Fan', SPIN)]), [null, 3] as never),
    ).not.toThrow();
    expect(() =>
      bindingsFromNodes(node('Root', undefined, [node('Fan', SPIN)]), undefined as never),
    ).not.toThrow();
    expect(partTree({ name: 'Root', children: garbage } as never).map(({ name }) => name)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });

  it('stops at a node that is its own descendant', () => {
    const loop: NodeInfo = { name: 'Loop', children: [] };
    (loop.children as NodeInfo[]).push(loop, node('Fan', SPIN));
    const root = node('Root', undefined, [loop]);

    expect(partTree(root).map(({ name }) => name)).toEqual(['Loop', 'Fan']);
  });
});
