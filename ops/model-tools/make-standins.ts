/*
 * `pnpm models:standins`: builds the demo's two placeholder models, the cooling tower and the standby
 * generator, and writes them to `ops/models/<class>.<hash>.glb` (V2-13.3, ADR-0020 § Serving: "the demo's
 * models are committed under `ops/models/`"). The vendor's files are the longest lead time, and the twin's
 * binding, hover and inspector (V2-14) cannot be built or looked at without a file that has the right node
 * names, pivots and `extras`; these have them, drawn as boxes and cylinders. The vendor's files replace them
 * (V2-13.8, V2-13.9) under new names.
 *
 * What each file is: the class's node tree (brief § Node naming and hierarchy; the generator's is V2-13.1's
 * proposal), every part a box or a cylinder with its pivot on its own axis of motion, bound parts carrying
 * `extras` copied from the "Bound part" columns of `docs/design/v2/asset-classes.md` plus a `label` (the
 * Parts section's word), four of the shared materials, Meshopt-compressed, no texture (KTX2 needs the native
 * `toktx`, ADR-0020), and a `<Root>_LOD1` sibling that is one merged silhouette. The model fills its class's
 * `footprint_m` exactly, so it replaces the neutral box of the same size without a data change.
 *
 * The same code gives the same bytes: no clock, no random number, nodes and meshes created in a fixed order,
 * the glTF `asset.generator` fixed (it would otherwise name the gltf-transform version, and every upgrade
 * would change every hash). A file is named by its hash, so a change that alters the bytes writes a new name
 * and leaves the old file: this script never deletes, it lists what is stale and the developer removes it.
 * `make-standins.test.ts` fails when the committed files are not what this script writes now.
 *
 * Not a workspace member and not linted; `pnpm models:typecheck` checks it.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { HASH_LENGTH, LOD1_SUFFIX, rootNameOf, sha256Hex } from './rules.ts';
import { box, cylinder, merge, translate, type Mesh, type Vec3 } from './standin-geometry.ts';

export const STAND_IN_CLASSES = ['cooling_tower', 'standby_generator'] as const;
export type StandInClass = (typeof STAND_IN_CLASSES)[number];

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const MODELS_DIR = join(REPO_ROOT, 'ops/models');

/** Fixed, so a gltf-transform upgrade does not change every hash for nothing. */
const GENERATOR = 'ops-command-center make-standins';

/** Sides of a cylinder in the full model and in its lower level of detail (about 10 – 15 % of the triangles). */
const SEGMENTS = { lod0: 24, lod1: 8 } as const;

// ---------------------------------------------------------------------------------------------------------
// Materials: four of the library (`MATERIAL_LIBRARY`); the console replaces each by its own of that name.
// ---------------------------------------------------------------------------------------------------------

type MaterialName = 'Part' | 'Steel' | 'Blade' | 'Xray';

const MATERIALS: Record<
  MaterialName,
  { color: [number, number, number, number]; blend?: boolean }
> = {
  Part: { color: [0.55, 0.58, 0.62, 1] },
  Steel: { color: [0.75, 0.78, 0.8, 1] },
  Blade: { color: [0.2, 0.22, 0.25, 1] },
  // The generator's enclosure is drawn see-through (frame 08).
  Xray: { color: [0.4, 0.6, 0.8, 0.25], blend: true },
};

// ---------------------------------------------------------------------------------------------------------
// The description of a model: a tree of parts, each a few shapes around its own pivot.
// ---------------------------------------------------------------------------------------------------------

type Shape =
  | { kind: 'box'; size: Vec3; at?: Vec3 }
  | { kind: 'cylinder'; radius: number; height: number; axis?: 'x' | 'y' | 'z'; at?: Vec3 };

type Extras = Record<string, unknown>;

interface Part {
  name: string;
  /** The pivot, in the parent's space (the model's, for a top-level part): +Y up, the origin at the centre of the footprint on the ground. */
  at: Vec3;
  /** Around the pivot. */
  shapes: Shape[];
  material: MaterialName;
  /** Only on a bound part. */
  extras?: Extras;
  children?: Part[];
}

interface StandIn {
  /** `footprint_m` of the class in `asset-classes.md` and the seed: the model's outer box, width × height × depth in metres. */
  footprintM: { width: number; depth: number; height: number };
  parts: Part[];
  /** The lower level of detail: one merged silhouette, in the model's space. */
  lod1: Shape[];
}

const spin = (bind: string, label: string): Extras => ({
  bind,
  motion: 'spin',
  axis: 'y',
  range: [0, 1800],
  label,
});
const turn = (bind: string, label: string, range: [number, number]): Extras => ({
  bind,
  motion: 'turn',
  axis: 'x',
  range,
  label,
});
const tint = (bind: string, label: string): Extras => ({ bind, motion: 'tint', label });

/** Four blades around a hub, flat, centred on the pivot so the part spins about its own axis. */
const fanShapes = (hub: number, along: number, across: number): Shape[] => [
  { kind: 'cylinder', radius: hub, height: 0.1 },
  { kind: 'box', size: [along, 0.04, 0.2], at: [along / 2 + hub / 2, 0, 0] },
  { kind: 'box', size: [along, 0.04, 0.2], at: [-(along / 2 + hub / 2), 0, 0] },
  { kind: 'box', size: [0.2, 0.04, across], at: [0, 0, across / 2 + hub / 2] },
  { kind: 'box', size: [0.2, 0.04, across], at: [0, 0, -(across / 2 + hub / 2)] },
];

/**
 * Cooling tower, 4.0 × 4.0 × 5.0 m. The casing is narrower than the footprint so the pump, the pipe, the
 * riser and the control panel stand proud of it and reach the edges: the outer box is the footprint.
 */
const COOLING_TOWER: StandIn = {
  footprintM: { width: 4, depth: 4, height: 5 },
  parts: [
    {
      name: 'Casing',
      at: [0, 1.4, 0],
      material: 'Part',
      shapes: [{ kind: 'box', size: [3.6, 2.8, 3.6] }],
    },
    {
      name: 'FanStack',
      at: [0, 3.9, 0],
      material: 'Steel',
      shapes: [{ kind: 'cylinder', radius: 1.4, height: 2.2 }],
      children: [
        // The pivot is the hub, 0.3 m above the middle of the stack (y 4.2).
        {
          name: 'FanBlade',
          at: [0, 0.3, 0],
          material: 'Blade',
          shapes: fanShapes(0.18, 1.0, 1.0),
          extras: spin('fanSpeedRpm', 'Fan blade'),
        },
      ],
    },
    {
      name: 'FanMotor',
      at: [0, 3.4, 0],
      material: 'Steel',
      shapes: [{ kind: 'box', size: [0.5, 0.4, 0.5] }],
      extras: tint('motorTempC', 'Fan motor'),
    },
    {
      name: 'Pump',
      at: [1.65, 0.4, -1.2],
      material: 'Steel',
      shapes: [{ kind: 'cylinder', radius: 0.35, height: 0.8 }],
      extras: tint('pumpFlowM3h', 'Pump'),
    },
    {
      name: 'Pipe',
      at: [0, 0.6, -1.9],
      material: 'Steel',
      shapes: [{ kind: 'cylinder', radius: 0.1, height: 2.6, axis: 'x' }],
    },
    {
      name: 'Riser',
      at: [-1.9, 1.4, -1.9],
      material: 'Steel',
      shapes: [{ kind: 'cylinder', radius: 0.1, height: 2.8 }],
    },
    {
      // The pivot is the valve's stem on the +z face; the handle stands above it and swings about x.
      name: 'Valve',
      at: [-0.8, 0.8, 1.85],
      material: 'Part',
      shapes: [{ kind: 'box', size: [0.1, 0.3, 0.1], at: [0, 0.15, 0.05] }],
      extras: turn('valveOpenPct', 'Valve', [0, 90]),
    },
    {
      name: 'ControlPanel',
      at: [1.0, 0.9, 1.8],
      material: 'Part',
      shapes: [{ kind: 'box', size: [0.8, 1.2, 0.4] }],
      children: [
        {
          name: 'Switch',
          at: [0, 0.35, 0.12],
          material: 'Steel',
          shapes: [{ kind: 'box', size: [0.06, 0.18, 0.08], at: [0, 0.09, 0.04] }],
          extras: turn('switchState', 'Switch', [-35, 35]),
        },
      ],
    },
  ],
  lod1: [
    { kind: 'box', size: [3.6, 2.8, 3.6], at: [0, 1.4, 0] },
    { kind: 'cylinder', radius: 1.4, height: 2.2, at: [0, 3.9, 0] },
  ],
};

/**
 * Standby generator, 6.0 × 2.5 × 3.0 m (the tree is V2-13.1's proposal). The enclosure runs from the west
 * end to the radiator, which closes the east end; the battery (−z) and the control panel (+z) stand proud of
 * the enclosure's sides and the exhaust stack reaches the full height.
 */
const STANDBY_GENERATOR: StandIn = {
  footprintM: { width: 6, depth: 2.5, height: 3 },
  parts: [
    {
      name: 'Enclosure',
      at: [-0.4, 1.2, 0],
      material: 'Xray',
      shapes: [{ kind: 'box', size: [5.2, 2.4, 2.2] }],
    },
    {
      name: 'FuelTank',
      at: [-1.95, 0.35, 0],
      material: 'Part',
      shapes: [{ kind: 'box', size: [1.8, 0.6, 1.2] }],
      extras: tint('fuelLevelPct', 'Fuel tank'),
    },
    {
      name: 'Battery',
      at: [-2.5, 0.35, -1.1],
      material: 'Steel',
      shapes: [{ kind: 'box', size: [0.5, 0.35, 0.3] }],
      extras: tint('starterBatteryV', 'Starter battery'),
    },
    {
      name: 'Engine',
      at: [-0.2, 0.8, 0],
      material: 'Part',
      shapes: [{ kind: 'box', size: [1.6, 1.1, 1.1] }],
      extras: tint('coolantTempC', 'Engine'),
    },
    {
      name: 'Alternator',
      at: [1.2, 0.85, 0],
      material: 'Steel',
      shapes: [{ kind: 'cylinder', radius: 0.4, height: 1.2, axis: 'x' }],
      extras: tint('alternatorKw', 'Alternator'),
    },
    {
      name: 'Radiator',
      at: [2.6, 0.9, 0],
      material: 'Steel',
      shapes: [{ kind: 'box', size: [0.8, 1.8, 2.0] }],
      children: [
        // The pivot is on top of the radiator (y 1.85); the blades stay inside its footprint.
        {
          name: 'RadiatorFan',
          at: [0, 0.95, 0],
          material: 'Blade',
          shapes: fanShapes(0.12, 0.3, 0.7),
          extras: spin('engineSpeedRpm', 'Radiator'),
        },
      ],
    },
    {
      name: 'ControlPanel',
      at: [-1.2, 1.0, 1.1],
      material: 'Part',
      shapes: [{ kind: 'box', size: [0.8, 1.2, 0.3] }],
      extras: tint('controlMode', 'Control panel'),
      children: [
        {
          name: 'Breaker',
          at: [0, 0.3, 0.05],
          material: 'Steel',
          shapes: [{ kind: 'box', size: [0.08, 0.2, 0.1], at: [0, 0.1, 0.05] }],
          extras: turn('breakerClosed', 'Breaker', [0, 35]),
        },
      ],
    },
    {
      name: 'Silencer',
      at: [-1.6, 2.65, 0],
      material: 'Part',
      shapes: [{ kind: 'box', size: [0.8, 0.5, 0.6] }],
    },
    {
      name: 'ExhaustStack',
      at: [-2.6, 2.7, 0],
      material: 'Steel',
      shapes: [{ kind: 'cylinder', radius: 0.15, height: 0.6 }],
    },
  ],
  lod1: [
    { kind: 'box', size: [5.2, 2.4, 2.2], at: [-0.4, 1.2, 0] },
    { kind: 'box', size: [0.8, 1.8, 2.0], at: [2.6, 0.9, 0] },
    { kind: 'cylinder', radius: 0.15, height: 0.6, at: [-2.6, 2.7, 0] },
  ],
};

const STAND_INS: Record<StandInClass, StandIn> = {
  cooling_tower: COOLING_TOWER,
  standby_generator: STANDBY_GENERATOR,
};

/** The footprint a stand-in fills, for the log and the specs. */
export const standInFootprint = (classCode: StandInClass) => STAND_INS[classCode].footprintM;

// ---------------------------------------------------------------------------------------------------------
// Building the file
// ---------------------------------------------------------------------------------------------------------

const ORIGIN: Vec3 = [0, 0, 0];

function meshOf(shapes: readonly Shape[], segments: number): Mesh {
  return merge(
    shapes.map((shape) => {
      const at = shape.at ?? ORIGIN;
      return translate(
        shape.kind === 'box'
          ? box(shape.size)
          : cylinder({ radius: shape.radius, height: shape.height, axis: shape.axis, segments }),
        at,
      );
    }),
  );
}

/** The bytes of a class's stand-in: a `.glb`, Meshopt-compressed, the same bytes every time. */
export async function buildStandIn(classCode: StandInClass): Promise<Uint8Array> {
  await MeshoptEncoder.ready;
  const description = STAND_INS[classCode];
  const rootName = rootNameOf(classCode);

  const document = new Document();
  document.getRoot().getAsset().generator = GENERATOR;
  const buffer = document.createBuffer();
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  const materials = new Map<MaterialName, Material>();
  const materialOf = (name: MaterialName): Material => {
    let material = materials.get(name);
    if (!material) {
      const { color, blend } = MATERIALS[name];
      material = document.createMaterial(name).setBaseColorFactor(color);
      if (blend) material.setAlphaMode('BLEND');
      materials.set(name, material);
    }
    return material;
  };

  const attach = (node: ReturnType<Document['createNode']>, mesh: Mesh, material: MaterialName) => {
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(Float32Array.from(mesh.positions))
      .setBuffer(buffer);
    const normal = document
      .createAccessor()
      .setType('VEC3')
      .setArray(Float32Array.from(mesh.normals))
      .setBuffer(buffer);
    const indices = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(Uint16Array.from(mesh.indices))
      .setBuffer(buffer);
    const primitive = document
      .createPrimitive()
      .setAttribute('POSITION', position)
      .setAttribute('NORMAL', normal)
      .setIndices(indices)
      .setMaterial(materialOf(material));
    node.setMesh(document.createMesh(node.getName()).addPrimitive(primitive));
  };

  const build = (part: Part) => {
    const node = document.createNode(part.name).setTranslation([...part.at]);
    if (part.extras) node.setExtras(part.extras);
    attach(node, meshOf(part.shapes, SEGMENTS.lod0), part.material);
    for (const child of part.children ?? []) node.addChild(build(child));
    return node;
  };

  const root = document.createNode(rootName);
  for (const part of description.parts) root.addChild(build(part));

  // The lower level of detail is a top-level sibling with the same pivot (the identity) and no `extras`.
  const lod1 = document.createNode(rootName + LOD1_SUFFIX);
  attach(lod1, meshOf(description.lod1, SEGMENTS.lod1), 'Part');

  document.createScene('Scene').addChild(root).addChild(lod1);

  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
    .writeBinary(document);
}

/** `<class>.<first 12 hex of the SHA-256>.glb` (ADR-0020 § Serving). */
export const standInFileName = (classCode: StandInClass, bytes: Uint8Array): string =>
  `${classCode}.${sha256Hex(bytes).slice(0, HASH_LENGTH)}.glb`;

// ---------------------------------------------------------------------------------------------------------
// Writing the files
// ---------------------------------------------------------------------------------------------------------

export interface StandInReport {
  /** Files written now. */
  written: string[];
  /** Files already there with exactly these bytes. */
  unchanged: string[];
  /** Other files of a stand-in class: older versions, to delete by hand. */
  stale: string[];
}

/**
 * Writes the stand-ins to `dir`, which it creates if it is missing. A file that is already there with these
 * bytes is left alone. Files of the same class under another name are reported as stale, never deleted: a
 * vendor's file sits beside a stand-in while it is being brought in.
 */
export async function writeStandIns(
  dir: string,
  log: (line: string) => void = () => {},
): Promise<StandInReport> {
  await mkdir(dir, { recursive: true });
  const report: StandInReport = { written: [], unchanged: [], stale: [] };
  const present = await readdir(dir);

  for (const classCode of STAND_IN_CLASSES) {
    const bytes = await buildStandIn(classCode);
    const name = standInFileName(classCode, bytes);
    const path = join(dir, name);

    const existing = present.includes(name) ? await readFile(path) : null;
    if (existing && Buffer.compare(existing, bytes) === 0) {
      report.unchanged.push(name);
      log(`models:standins: ${name} unchanged`);
    } else {
      await writeFile(path, bytes);
      report.written.push(name);
      log(`models:standins: wrote ${name} (${bytes.byteLength} bytes)`);
    }

    const sameClass = new RegExp(`^${classCode}\\.[0-9a-f]{${HASH_LENGTH}}\\.glb$`);
    for (const other of present.filter((file) => sameClass.test(file) && file !== name).sort()) {
      report.stale.push(other);
      log(`models:standins: stale ${other}, delete it by hand (the current file is ${name})`);
    }
  }
  return report;
}

// Run as a command, not when the specs import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeStandIns(MODELS_DIR, console.log);
}
