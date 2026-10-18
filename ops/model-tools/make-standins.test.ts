/*
 * Specs for the stand-in models (`pnpm models:test`, Node's own runner). They hold three things together: the
 * generator (`make-standins.ts`), the contract (`check.ts`, V2-13.2) and the document the bindings come from
 * (`docs/design/v2/asset-classes.md`, parsed below), so a change to any of them fails here first. They also
 * require the committed files to be what the generator writes now.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { NodeIO, type Document, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { checkDirectory, loadClassPoints } from './check.ts';
import {
  buildStandIn,
  STAND_IN_CLASSES,
  standInFileName,
  writeStandIns,
  type StandInClass,
} from './make-standins.ts';
import { LOD1_SUFFIX, rootNameOf } from './rules.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const MODELS_DIR = join(REPO_ROOT, 'ops/models');
/** Metres: far finer than anything drawn, coarser than a float. */
const TOLERANCE = 1e-4;

// ---------------------------------------------------------------------------------------------------------
// The document the models are held to
// ---------------------------------------------------------------------------------------------------------

const LINES = (await readFile(join(REPO_ROOT, 'docs/design/v2/asset-classes.md'), 'utf8')).split(
  '\n',
);

/** The lines under the heading that matches, up to the next heading. */
function section(heading: RegExp): string[] {
  const start = LINES.findIndex((line) => heading.test(line));
  assert.ok(start >= 0, `asset-classes.md has no heading matching ${heading}`);
  const end = LINES.findIndex((line, i) => i > start && /^#{2,3} /.test(line));
  return LINES.slice(start + 1, end === -1 ? undefined : end);
}

const cells = (row: string): string[] =>
  row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());

/** The data rows of the first table in `lines` (the header and its rule are skipped). */
const tableRows = (lines: string[]): string[][] =>
  lines
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map(cells);

const unquote = (text: string): string => text.replace(/`/g, '');

interface BoundPart {
  node: string;
  bind: string;
  motion: string;
  axis?: string;
  range?: number[];
  label: string;
}

/** `footprint_m` of a class, width × depth × height, from the Classes table. */
function footprintOf(classCode: StandInClass): { width: number; depth: number; height: number } {
  const row = tableRows(section(/^## Classes$/)).find(
    (each) => unquote(each[1] ?? '') === classCode,
  );
  assert.ok(row, `no row for ${classCode} in the Classes table of asset-classes.md`);
  const [width, depth, height] = (row[3] ?? '').split('×').map((part) => Number(part.trim()));
  assert.ok(width && depth && height, `cannot read ${classCode}'s footprint from "${row[3]}"`);
  return { width, depth, height };
}

const BOUND_PART = /^`(\w+)`(?: · (\w+))?(?: · ([xyz]) · \[(-?[\d.]+), (-?[\d.]+)\])?$/;

/** The "Bound part" column of the class's telemetry table, with the Parts table's label for each node. */
function boundPartsOf(classCode: StandInClass): BoundPart[] {
  const labels = new Map(
    tableRows(section(/^### Parts of an asset$/))
      .filter((row) => unquote(row[0] ?? '') === classCode)
      .map((row) => [unquote(row[1] ?? ''), row[2] ?? ''] as const),
  );
  const rows = tableRows(section(new RegExp(`^### .*\\(\`${classCode}\``)));
  const bound: BoundPart[] = [];
  for (const row of rows) {
    const cell = row[row.length - 1] ?? '';
    if (cell === 'none') continue;
    const match = BOUND_PART.exec(cell);
    assert.ok(match?.[1] && match[2], `cannot read the Bound part "${cell}" of ${classCode}`);
    const [, node = '', motion = '', axis, from, to] = match;
    bound.push({
      node,
      bind: unquote(row[0] ?? ''),
      motion,
      ...(axis ? { axis, range: [Number(from), Number(to)] } : {}),
      label: labels.get(node) ?? `(no label for ${node} in the Parts table)`,
    });
  }
  return bound.sort((a, b) => a.node.localeCompare(b.node));
}

/** The "Static part(s):" line under the class's table. */
function staticPartsOf(classCode: StandInClass): string[] {
  const line = section(new RegExp(`^### .*\\(\`${classCode}\``)).find((each) =>
    each.startsWith('Static part'),
  );
  assert.ok(line, `no "Static part" line for ${classCode} in asset-classes.md`);
  return [...line.matchAll(/`(\w+)`/g)].map((match) => match[1]!);
}

// ---------------------------------------------------------------------------------------------------------
// The models
// ---------------------------------------------------------------------------------------------------------

await MeshoptDecoder.ready;
const reader = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

const BYTES = Object.fromEntries(
  await Promise.all(
    STAND_IN_CLASSES.map(async (classCode) => [classCode, await buildStandIn(classCode)] as const),
  ),
) as Record<StandInClass, Uint8Array>;
const DOCUMENTS = Object.fromEntries(
  await Promise.all(
    STAND_IN_CLASSES.map(
      async (classCode) => [classCode, await reader.readBinary(BYTES[classCode])] as const,
    ),
  ),
) as Record<StandInClass, Document>;

const nodeNamed = (document: Document, name: string): Node => {
  const node = document
    .getRoot()
    .listNodes()
    .find((each) => each.getName() === name);
  assert.ok(node, `no node named ${name}`);
  return node;
};

interface Bounds {
  min: number[];
  max: number[];
}

/** The box around a node and everything under it, in the model's space; `local` leaves the node's own transform out. */
function boundsOf(node: Node, local = false): Bounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  node.traverse((each) => {
    const mesh = each.getMesh();
    if (!mesh) return;
    const m =
      local && each === node
        ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        : each.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      assert.ok(position);
      const v = [0, 0, 0];
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, v);
        const point = [
          m[0]! * v[0]! + m[4]! * v[1]! + m[8]! * v[2]! + m[12]!,
          m[1]! * v[0]! + m[5]! * v[1]! + m[9]! * v[2]! + m[13]!,
          m[2]! * v[0]! + m[6]! * v[1]! + m[10]! * v[2]! + m[14]!,
        ];
        point.forEach((value, axis) => {
          min[axis] = Math.min(min[axis]!, value);
          max[axis] = Math.max(max[axis]!, value);
        });
      }
    }
  });
  return { min, max };
}

const near = (actual: number, expected: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= TOLERANCE, `${what}: ${actual}, expected ${expected}`);

/** The tree the generator and the brief agree on: a node, and the node it sits under (`null`: under the class root). */
const PARENTS: Record<StandInClass, Record<string, string | null>> = {
  cooling_tower: {
    Casing: null,
    FanStack: null,
    FanBlade: 'FanStack',
    FanMotor: null,
    Pump: null,
    Pipe: null,
    Riser: null,
    Valve: null,
    ControlPanel: null,
    Switch: 'ControlPanel',
  },
  standby_generator: {
    Enclosure: null,
    FuelTank: null,
    Battery: null,
    Engine: null,
    Alternator: null,
    Radiator: null,
    RadiatorFan: 'Radiator',
    ControlPanel: null,
    Breaker: 'ControlPanel',
    Silencer: null,
    ExhaustStack: null,
  },
};

// ---------------------------------------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------------------------------------

describe('the document', () => {
  it('has a footprint and bound parts for both classes, so the specs below are not vacuous', () => {
    for (const classCode of STAND_IN_CLASSES) {
      assert.ok(footprintOf(classCode).width > 0);
      assert.ok(boundPartsOf(classCode).length > 0, `no bound parts read for ${classCode}`);
      assert.ok(staticPartsOf(classCode).length > 0);
    }
  });
});

describe('the stand-in models', () => {
  const directories: string[] = [];
  after(async () => {
    await Promise.all(directories.map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const temporaryDirectory = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'standins-'));
    directories.push(dir);
    return dir;
  };

  it('pass the checker (pnpm models:check) under their real names', async () => {
    const dir = await temporaryDirectory();
    for (const classCode of STAND_IN_CLASSES) {
      await writeFile(join(dir, standInFileName(classCode, BYTES[classCode])), BYTES[classCode]);
    }

    const report = await checkDirectory(dir, await loadClassPoints());

    assert.deepEqual(report.failures, []);
    assert.equal(report.checked, STAND_IN_CLASSES.length);
  });

  for (const classCode of STAND_IN_CLASSES) {
    describe(classCode, () => {
      const document = DOCUMENTS[classCode];
      const root = rootNameOf(classCode);

      it('fills its footprint_m exactly: centred on x and z, standing on the ground', () => {
        const { width, depth, height } = footprintOf(classCode);
        const { min, max } = boundsOf(nodeNamed(document, root));

        near(min[0]!, -width / 2, 'min x');
        near(max[0]!, width / 2, 'max x');
        near(min[1]!, 0, 'min y');
        near(max[1]!, height, 'max y');
        near(min[2]!, -depth / 2, 'min z');
        near(max[2]!, depth / 2, 'max z');
      });

      it('has every bound part of asset-classes.md with its motion, axis, range and label, and no other', () => {
        const actual = document
          .getRoot()
          .listNodes()
          .filter((node) => node.getExtras().bind !== undefined)
          .map((node) => {
            const { bind, motion, axis, range, label } = node.getExtras() as Record<
              string,
              unknown
            >;
            return JSON.parse(
              JSON.stringify({ node: node.getName(), bind, motion, axis, range, label }),
            ) as BoundPart;
          })
          .sort((a, b) => a.node.localeCompare(b.node));

        assert.deepEqual(actual, boundPartsOf(classCode));
      });

      it('has the static parts of the document, unbound, and the tree it is meant to have', () => {
        for (const name of staticPartsOf(classCode)) {
          assert.equal(
            nodeNamed(document, name).getExtras().bind,
            undefined,
            `${name} should be static`,
          );
        }
        for (const [name, parent] of Object.entries(PARENTS[classCode])) {
          const node = nodeNamed(document, name);
          assert.equal(
            node.getParentNode()?.getName() ?? null,
            parent ?? root,
            `parent of ${name}`,
          );
        }
        // Nothing but the tree above, the class root and its lower level.
        const known = new Set([root, root + LOD1_SUFFIX, ...Object.keys(PARENTS[classCode])]);
        const unknown = document
          .getRoot()
          .listNodes()
          .map((node) => node.getName())
          .filter((name) => !known.has(name));
        assert.deepEqual(unknown, []);
      });

      it('has the lower level of detail inside the full model, as a top-level sibling', () => {
        const lod1 = nodeNamed(document, root + LOD1_SUFFIX);
        assert.equal(lod1.getParentNode(), null);
        assert.deepEqual(lod1.getTranslation(), [0, 0, 0]);
        const full = boundsOf(nodeNamed(document, root));
        const low = boundsOf(lod1);
        for (let axis = 0; axis < 3; axis++) {
          assert.ok(low.min[axis]! >= full.min[axis]! - TOLERANCE, `LOD1 min on axis ${axis}`);
          assert.ok(low.max[axis]! <= full.max[axis]! + TOLERANCE, `LOD1 max on axis ${axis}`);
        }
      });

      it('has the same bytes every time, under the name the hash gives', async () => {
        const again = await buildStandIn(classCode);
        assert.equal(Buffer.compare(Buffer.from(again), Buffer.from(BYTES[classCode])), 0);
        assert.match(
          standInFileName(classCode, again),
          new RegExp(`^${classCode}\\.[0-9a-f]{12}\\.glb$`),
        );
      });

      it('is committed under ops/models, once, with exactly the bytes the generator writes now', async () => {
        const files = (await readdir(MODELS_DIR)).filter((name) =>
          name.startsWith(`${classCode}.`),
        );
        const expected = standInFileName(classCode, BYTES[classCode]);
        assert.deepEqual(
          files,
          [expected],
          `run \`pnpm models:standins\` (and delete any older ${classCode} file)`,
        );
        const committed = await readFile(join(MODELS_DIR, expected));
        assert.equal(
          Buffer.compare(committed, Buffer.from(BYTES[classCode])),
          0,
          `${expected} differs from what the generator writes; run \`pnpm models:standins\``,
        );
      });
    });
  }

  it('turns the spinning parts about their own axis: the pivot is the middle of the part', () => {
    for (const [classCode, name] of [
      ['cooling_tower', 'FanBlade'],
      ['standby_generator', 'RadiatorFan'],
    ] as const) {
      const { min, max } = boundsOf(nodeNamed(DOCUMENTS[classCode], name), true);
      near((min[0]! + max[0]!) / 2, 0, `${name} centre x`);
      near((min[2]! + max[2]!) / 2, 0, `${name} centre z`);
    }
  });

  it('are written by writeStandIns once, left alone the second time, and never delete a file they did not write', async () => {
    const dir = join(await temporaryDirectory(), 'models');

    const first = await writeStandIns(dir);
    assert.deepEqual(first.written.length, STAND_IN_CLASSES.length);
    assert.deepEqual(first.unchanged, []);
    const file = join(dir, first.written[0]!);
    const before = (await stat(file)).mtimeMs;

    const second = await writeStandIns(dir);
    assert.deepEqual(second.written, []);
    assert.deepEqual(second.unchanged.length, STAND_IN_CLASSES.length);
    assert.equal((await stat(file)).mtimeMs, before, 'an unchanged file is not written again');

    const foreign = 'cooling_tower.0123456789ab.glb';
    await writeFile(join(dir, foreign), 'a vendor file');
    const third = await writeStandIns(dir);
    assert.deepEqual(third.stale, [foreign]);
    assert.equal(
      await readFile(join(dir, foreign), 'utf8'),
      'a vendor file',
      'a stale file is reported, not deleted',
    );
  });

  it('create the directory when it is missing', async () => {
    const parent = await temporaryDirectory();
    await mkdir(join(parent, 'there'));
    const report = await writeStandIns(join(parent, 'there', 'models'));
    assert.equal(report.written.length, STAND_IN_CLASSES.length);
  });
});
