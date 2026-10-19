import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TelemetryPoint } from '@occ/contracts';
// `?raw` (typed by `vite/client`): the files' text. The paths are from `apps/console/src/lib` to the repo root,
// as in `twinBindings.test.ts`.
import assetClassesText from '../../../../docs/design/v2/asset-classes.md?raw';
import catalogueText from '../../../../ops/telemetry-sim/catalogue.json?raw';
import { nodeInfos, readGlbJson } from './glbJson';
import { hasChildren, type PartRow, partRows, partText, sentenceCase } from './modelParts';
import { bindingsFromNodes, type NodeInfo } from './twinBindings';

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: null,
  ...overrides,
});

const node = (name: string, extras?: unknown, children?: NodeInfo[]): NodeInfo => ({
  name,
  ...(extras === undefined ? {} : { extras }),
  ...(children === undefined ? {} : { children }),
});

describe('sentenceCase', () => {
  it.each([
    ['Casing', 'Casing'],
    ['FanBlade', 'Fan blade'],
    ['ControlPanel', 'Control panel'],
    ['ExhaustStackTop', 'Exhaust stack top'],
    ['Fan2Blade', 'Fan2 blade'],
    ['fanBlade', 'Fan blade'],
    ['', ''],
  ])('writes %j as %j', (name, label) => {
    expect(sentenceCase(name)).toBe(label);
  });

  it('leaves an acronym as written', () => {
    expect(sentenceCase('HVACUnit')).toBe('HVACUnit');
    expect(sentenceCase('FanBLADE')).toBe('Fan BLADE');
    expect(sentenceCase('PumpPLC')).toBe('Pump PLC');
  });
});

describe('partRows', () => {
  const points = [
    point(),
    point({ key: 'valveOpenPct', kind: 'number', unit: '%', min: 0, max: 100 }),
  ];
  const fan = {
    bind: 'fanSpeedRpm',
    motion: 'spin',
    axis: 'y',
    range: [0, 1800],
    label: 'Fan blade',
  };

  it('lists every named node in document order, children straight after their parent', () => {
    const root = node('Tower', undefined, [
      node('Casing'),
      node('FanStack', undefined, [node('FanBlade', fan)]),
      node('Pipe'),
    ]);

    expect(partRows(root, points)).toEqual([
      { name: 'Casing', label: 'Casing', bind: null, parent: null },
      { name: 'FanStack', label: 'Fan stack', bind: null, parent: null },
      { name: 'FanBlade', label: 'Fan blade', bind: 'fanSpeedRpm', parent: 'FanStack' },
      { name: 'Pipe', label: 'Pipe', bind: null, parent: null },
    ]);
  });

  it('takes a bound row’s label from the model, and the node name when it gives none', () => {
    const valve = { bind: 'valveOpenPct', motion: 'turn', axis: 'x', range: [0, 90] };
    const rows = partRows(node('Tower', undefined, [node('MainValve', valve)]), points);

    expect(rows).toEqual([
      { name: 'MainValve', label: 'Main valve', bind: 'valveOpenPct', parent: null },
    ]);
  });

  it('does not list the root, a _ helper, an unnamed node or a repeated name', () => {
    const root = node('Tower', undefined, [
      node('Casing'),
      node('_Pivot', undefined, [node('Valve')]),
      node('', undefined, [node('Lid')]),
      node('Casing'),
    ]);
    const rows = partRows(root, points);

    expect(rows.map((row) => row.name)).toEqual(['Casing', 'Valve', 'Lid']);
    expect(rows.map((row) => row.parent)).toEqual([null, null, null]);
  });

  it('reads a bound node whose binding was dropped as a static row with its name’s label', () => {
    const unknown = { bind: 'noSuchPoint', motion: 'tint', label: 'Ghost part' };
    const rows = partRows(node('Tower', undefined, [node('Ghost', unknown)]), points);

    expect(rows).toEqual([{ name: 'Ghost', label: 'Ghost', bind: null, parent: null }]);
  });

  it('gives no rows for a root with no children', () => {
    expect(partRows(node('Tower'), points)).toEqual([]);
  });
});

describe('hasChildren', () => {
  it('is true for a row another row sits under', () => {
    const rows = partRows(
      node('Tower', undefined, [node('FanStack', undefined, [node('FanBlade')]), node('Casing')]),
      [],
    );
    const [fanStack, , casing] = rows;

    expect(fanStack && hasChildren(fanStack, rows)).toBe(true);
    expect(casing && hasChildren(casing, rows)).toBe(false);
  });
});

describe('partText', () => {
  const fan = point();

  it('says static for a part that binds nothing, even when stale', () => {
    expect(partText({ bind: null }, undefined, undefined, false)).toBe('static');
    expect(partText({ bind: null }, undefined, undefined, true)).toBe('static');
  });

  it('writes the reading as the readings rows do', () => {
    expect(partText({ bind: 'fanSpeedRpm' }, fan, 1420, false)).toBe('1,420 rpm');
    expect(
      partText(
        { bind: 'breakerClosed' },
        point({ key: 'breakerClosed', kind: 'boolean', unit: null }),
        false,
        false,
      ),
    ).toBe('Open');
  });

  it('says "last" before a reading that is not live', () => {
    expect(partText({ bind: 'fanSpeedRpm' }, fan, 1420, true)).toBe('last 1,420 rpm');
  });

  it('shows a dash for a part with no reading or no point, never "last —"', () => {
    expect(partText({ bind: 'fanSpeedRpm' }, fan, undefined, false)).toBe('—');
    expect(partText({ bind: 'fanSpeedRpm' }, fan, undefined, true)).toBe('—');
    expect(partText({ bind: 'fanSpeedRpm' }, undefined, 1420, false)).toBe('—');
  });
});

/*
 * The oracle (V2-14.10, AC1) is the two stand-in models in `ops/models` read the way the console reads a
 * delivered file, against asset-classes.md § Parts of an asset (the bound parts, their labels and points) and the
 * simulator's copy of the seeded catalogue (the points of each class). The models are the rows' source now, so a
 * label or a binding changed in a model, in the doc or in the catalogue fails here.
 */

const MODELLED = ['cooling_tower', 'standby_generator'] as const;

// `import.meta.url` is not a `file:` URL under jsdom; the directory is.
const MODELS_DIR = resolve(import.meta.dirname, '../../../../ops/models');

/** The class root of the stand-in model of `classCode`, as the console reads it from the file. */
function standIn(classCode: string): NodeInfo {
  const file = readdirSync(MODELS_DIR).find(
    (name) => name.startsWith(`${classCode}.`) && name.endsWith('.glb'),
  );
  if (file === undefined) throw new Error(`ops/models has no ${classCode} model`);
  const root = nodeInfos(readGlbJson(readFileSync(resolve(MODELS_DIR, file))));
  if (root === null) throw new Error(`${file} has no class root`);
  return root;
}

const CATALOGUE = JSON.parse(catalogueText) as {
  assets: {
    classCode: string;
    points: Pick<TelemetryPoint, 'key' | 'kind' | 'min' | 'max' | 'enumValues'>[];
  }[];
};

function pointsOf(classCode: string): TelemetryPoint[] {
  const asset = CATALOGUE.assets.find((candidate) => candidate.classCode === classCode);
  if (asset === undefined) throw new Error(`catalogue.json has no asset of ${classCode}`);
  return asset.points.map(({ key, kind, min, max, enumValues }) =>
    point({ key, label: key, kind, min, max, enumValues, unit: null }),
  );
}

interface DocPart {
  classCode: string;
  name: string;
  label: string;
  bind: string;
}

/** The rows of § Parts of an asset's table: class, node, label, point, motion. */
function docParts(): DocPart[] {
  const lines = assetClassesText.split('\n');
  const start = lines.findIndex((line) => line.startsWith('### Parts of an asset'));
  if (start < 0) throw new Error('asset-classes.md has no § Parts of an asset');
  const end = lines.findIndex((line, index) => index > start && line.startsWith('#'));
  const unquote = (cell: string): string => cell.replace(/^`|`$/g, '');

  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .filter((line) => line.startsWith('| `'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
    .filter((cells) => cells.length === 5)
    .map(([classCode = '', name = '', label = '', bind = '']) => ({
      classCode: unquote(classCode),
      name: unquote(name),
      label,
      bind: unquote(bind),
    }));
}

describe('the stand-in models', () => {
  it.each(MODELLED)('give the bound rows of %s as asset-classes.md lists them', (classCode) => {
    const rows = partRows(standIn(classCode), pointsOf(classCode));
    const expected = docParts().filter((part) => part.classCode === classCode);
    expect(expected.length).toBeGreaterThan(0);

    const bound = rows.filter((row) => row.bind !== null);
    expect(bound.map(({ name, label, bind }) => ({ name, label, bind }))).toEqual(
      expect.arrayContaining(expected.map(({ name, label, bind }) => ({ name, label, bind }))),
    );
    expect(bound).toHaveLength(expected.length);
  });

  it.each(MODELLED)('have no node that fails to bind, in %s', (classCode) => {
    expect(bindingsFromNodes(standIn(classCode), pointsOf(classCode)).problems).toEqual([]);
  });

  it.each(MODELLED)('bind only points of %s in the seeded catalogue, once each', (classCode) => {
    const keys = pointsOf(classCode).map((candidate) => candidate.key);
    const bound = partRows(standIn(classCode), pointsOf(classCode)).flatMap((row) =>
      row.bind === null ? [] : [row.bind],
    );

    for (const key of bound) expect(keys, classCode).toContain(key);
    expect(new Set(bound).size).toBe(bound.length);
  });

  it.each(MODELLED)(
    'name each part once, children after a parent that is a row, in %s',
    (classCode) => {
      const rows = partRows(standIn(classCode), pointsOf(classCode));
      const names = rows.map((row) => row.name);

      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(names).size).toBe(names.length);
      expect(names.some((name) => name.endsWith('_LOD1') || name === standIn(classCode).name)).toBe(
        false,
      );
      for (const [index, row] of rows.entries()) {
        if (row.parent !== null) expect(names.indexOf(row.parent)).toBeLessThan(index);
      }
    },
  );

  it('puts FanBlade under FanStack, Switch under ControlPanel and Breaker under ControlPanel', () => {
    const parentOf = (classCode: string, name: string): PartRow['parent'] | undefined =>
      partRows(standIn(classCode), pointsOf(classCode)).find((row) => row.name === name)?.parent;

    expect(parentOf('cooling_tower', 'FanBlade')).toBe('FanStack');
    expect(parentOf('cooling_tower', 'Switch')).toBe('ControlPanel');
    expect(parentOf('standby_generator', 'Breaker')).toBe('ControlPanel');
  });
});
