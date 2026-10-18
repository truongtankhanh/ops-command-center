/*
 * The model contract as code: what `pnpm models:check` holds every `.glb` under `ops/models/` to (ADR-0020
 * § Budgets and § Model contract; brief § Model contract; V2-13.1 for the rules the brief leaves open).
 *
 * Pure on purpose: every function takes what it needs and returns `Failure[]`, so `check.test.ts` calls
 * them on files built in memory, and `check.ts` owns the file system. A number or a name that a vendor file
 * can disagree with is one constant below with its source, so settling a disagreement is editing the
 * constant (and the ADR's "Settled" block), never waiving the check.
 *
 * What this does not do: kinds of bound points and what drives a motion (V2-14.1), the on-screen triangle
 * budget (V2-19.4), and compressing anything: texture and geometry compression are the author's tools
 * (`gltf-transform`); this only checks the result.
 *
 * Not a workspace member and not linted (`pnpm lint` runs per workspace); `pnpm models:typecheck` checks it.
 * Node runs this file by stripping its types, so only erasable syntax and `.ts` import specifiers.
 */
import { createHash } from 'node:crypto';
import type { Document, Node, Primitive } from '@gltf-transform/core';

export interface Failure {
  /** A stable name for the rule, printed in the log and asserted by the specs. */
  rule: string;
  /** What is wrong, with the number that is wrong. */
  detail: string;
}

/** The numbers (brief § Format and budgets). Sizes in bytes use the repo's convention: 1 MB = 1,000,000 bytes. */
export const BUDGETS = {
  maxFileBytes: 1_500_000,
  maxTrianglesLod0: 50_000,
  /** "LOD1 adds at most a further 25 %" (V2-13.1): LOD1's triangles over LOD0's. */
  maxLod1Share: 0.25,
  maxMaterials: 4,
  maxTextureSide: 1024,
  maxTexturesPerMaterial: 3,
} as const;

/** The shared material library (V2-13.1): the console replaces an imported material with its own of that name. */
export const MATERIAL_LIBRARY: readonly string[] = [
  'Part',
  'Steel',
  'Concrete',
  'Rail',
  'Screen',
  'Blade',
  'Hub',
  'Xray',
];

/** `motion` values (brief § Node naming and hierarchy); only `tint` does not move the part. */
export const MOTIONS: readonly string[] = ['spin', 'turn', 'slide', 'tint'];
export const MOVING_MOTIONS: readonly string[] = ['spin', 'turn', 'slide'];
export const AXES: readonly string[] = ['x', 'y', 'z'];

/** The keys a bound node's `extras` may carry (brief; `label` is the Parts row's word, V2-13.1). */
export const EXTRAS_KEYS: readonly string[] = ['bind', 'motion', 'axis', 'range', 'label'];

/** `<class code>.<first 12 hex of the SHA-256 of the file's bytes>.glb` (ADR-0020 § Serving; V2-13.1). */
export const HASH_LENGTH = 12;
const FILE_NAME = /^([a-z][a-z0-9_]*)\.([0-9a-f]{12})\.glb$/;

/** The sibling node that carries the lower level of detail: `<Root>_LOD1` (V2-13.1). */
export const LOD1_SUFFIX = '_LOD1';

const EXT_MESHOPT = 'EXT_meshopt_compression';
const KTX2_MIME = 'image/ktx2';
/** glTF primitive modes. */
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;

/** `cooling_tower` → `CoolingTower`: the name a class's root node must have. */
export const rootNameOf = (classCode: string): string =>
  classCode
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

// ---------------------------------------------------------------------------------------------------------
// The directory and the file's bytes
// ---------------------------------------------------------------------------------------------------------

/**
 * One entry of `ops/models/`: only `.glb` files and a `README.md` belong there, and the layout is flat.
 * nginx serves this directory (ADR-0020), so a stray `.gltf` or `.bin` would be served too.
 */
export function checkDirectoryEntry(name: string, isDirectory: boolean): Failure[] {
  if (isDirectory) {
    return [
      { rule: 'subdirectory', detail: 'the directory is flat; a subdirectory is not served' },
    ];
  }
  if (name === 'README.md' || name.endsWith('.glb')) return [];
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '(none)';
  const kind = extension === '.gltf' ? 'a .gltf' : 'a loose file';
  return [{ rule: 'not-glb', detail: `${kind} (${extension}); only .glb files are allowed` }];
}

/** What the file's name says: its class and the hash it claims, or `null` when it does not follow the pattern. */
export function parseFileName(name: string): { classCode: string; hash: string } | null {
  const match = FILE_NAME.exec(name);
  return match?.[1] && match[2] ? { classCode: match[1], hash: match[2] } : null;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * The checks that need only the name and the bytes: the pattern, the hash, a known class and the size.
 * The name's class is returned so the caller can check the model against that class's points.
 */
export function checkFile(
  name: string,
  bytes: Uint8Array,
  classCodes: ReadonlySet<string>,
): { classCode: string | null; failures: Failure[] } {
  const failures: Failure[] = [];
  const parsed = parseFileName(name);
  let classCode: string | null = null;

  if (!parsed) {
    failures.push({
      rule: 'file-name',
      detail: `expected <class>.<${HASH_LENGTH} hex>.glb, the hex being the start of the SHA-256 of the file`,
    });
  } else {
    const actual = sha256Hex(bytes).slice(0, HASH_LENGTH);
    if (actual !== parsed.hash) {
      failures.push({
        rule: 'file-hash',
        detail: `the name says ${parsed.hash}, the file's SHA-256 starts with ${actual}`,
      });
    }
    if (classCodes.has(parsed.classCode)) {
      classCode = parsed.classCode;
    } else {
      failures.push({
        rule: 'unknown-class',
        detail: `"${parsed.classCode}" is not a class in the catalogue`,
      });
    }
  }

  if (bytes.byteLength > BUDGETS.maxFileBytes) {
    failures.push({
      rule: 'file-size',
      detail: `${bytes.byteLength} bytes, at most ${BUDGETS.maxFileBytes}`,
    });
  }
  return { classCode, failures };
}

// ---------------------------------------------------------------------------------------------------------
// What the glTF container says that the document model does not keep
// ---------------------------------------------------------------------------------------------------------

/** The part of a GLB's JSON chunk these rules read. */
export interface GlbJson {
  extensionsUsed?: string[];
  meshes?: {
    name?: string;
    primitives?: { attributes?: Record<string, number>; indices?: number }[];
  }[];
  accessors?: { bufferView?: number }[];
  bufferViews?: { extensions?: Record<string, unknown> }[];
}

/** Reads the JSON chunk of a GLB. Throws a plain `Error` that says what is wrong with the container. */
export function readGlbJson(bytes: Uint8Array): GlbJson {
  if (bytes.byteLength < 20) throw new Error('shorter than a GLB header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('missing the glTF magic number');
  if (view.getUint32(4, true) !== 2) throw new Error('not glTF version 2');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error('the first chunk is not JSON');
  if (20 + length > bytes.byteLength)
    throw new Error('the JSON chunk runs past the end of the file');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as GlbJson;
}

/**
 * Every vertex and index buffer must be Meshopt-compressed (ADR-0020 § Budgets). The document model does not
 * keep which accessor was compressed, so this reads the container: an accessor is compressed when the buffer
 * view under it carries `EXT_meshopt_compression`.
 */
export function checkGeometryCompression(json: GlbJson): Failure[] {
  const meshes = json.meshes ?? [];
  if (meshes.length === 0) return [];
  if (!json.extensionsUsed?.includes(EXT_MESHOPT)) {
    return [{ rule: 'geometry-compression', detail: `${EXT_MESHOPT} is not used` }];
  }
  const failures: Failure[] = [];
  meshes.forEach((mesh, index) => {
    const accessors = new Set<number>();
    for (const primitive of mesh.primitives ?? []) {
      Object.values(primitive.attributes ?? {}).forEach((accessor) => accessors.add(accessor));
      if (primitive.indices !== undefined) accessors.add(primitive.indices);
    }
    let plain = 0;
    for (const accessor of accessors) {
      const view = json.accessors?.[accessor]?.bufferView;
      if (view === undefined) continue;
      if (!json.bufferViews?.[view]?.extensions?.[EXT_MESHOPT]) plain++;
    }
    if (plain > 0) {
      failures.push({
        rule: 'geometry-compression',
        detail: `mesh ${JSON.stringify(mesh.name ?? `#${index}`)} has ${plain} buffer(s) that are not Meshopt-compressed`,
      });
    }
  });
  return failures;
}

/** The width and height in a KTX2 file's header, or `null` when it is not a KTX2 file. */
export function ktx2Size(image: Uint8Array): { width: number; height: number } | null {
  const identifier = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
  if (image.byteLength < 28 || identifier.some((byte, i) => image[i] !== byte)) return null;
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  return { width: view.getUint32(20, true), height: view.getUint32(24, true) };
}

// ---------------------------------------------------------------------------------------------------------
// The model itself
// ---------------------------------------------------------------------------------------------------------

function triangleCountOf(primitive: Primitive): number {
  const mode = primitive.getMode();
  const indices = primitive.getIndices();
  const count = indices
    ? indices.getCount()
    : (primitive.getAttribute('POSITION')?.getCount() ?? 0);
  if (mode === TRIANGLES) return Math.floor(count / 3);
  if (mode === TRIANGLE_STRIP || mode === TRIANGLE_FAN) return Math.max(0, count - 2);
  return 0;
}

/** Triangles of a node and of everything under it, an instanced mesh counted once per node that uses it. */
function triangleCountUnder(node: Node): number {
  let total = 0;
  node.traverse((each) => {
    for (const primitive of each.getMesh()?.listPrimitives() ?? []) {
      total += triangleCountOf(primitive);
    }
  });
  return total;
}

function topLevelNodes(document: Document): Node[] {
  return document
    .getRoot()
    .listScenes()
    .flatMap((scene) => scene.listChildren());
}

/** LOD0 against the 50,000 budget; LOD1 as a top-level sibling with no `extras` and a quarter of LOD0 at most. */
function checkLevelsOfDetail(document: Document, rootName: string): Failure[] {
  const failures: Failure[] = [];
  const top = topLevelNodes(document);
  const root = top.find((node) => node.getName() === rootName);
  const lod1Name = rootName + LOD1_SUFFIX;
  const lod1 = top.find((node) => node.getName() === lod1Name);

  const lod0 = root ? triangleCountUnder(root) : 0;
  if (lod0 > BUDGETS.maxTrianglesLod0) {
    failures.push({
      rule: 'triangles',
      detail: `${lod0} triangles in ${rootName}, at most ${BUDGETS.maxTrianglesLod0}`,
    });
  }

  const elsewhere = document
    .getRoot()
    .listNodes()
    .some((node) => node.getName() === lod1Name && !top.includes(node));
  if (elsewhere) {
    failures.push({
      rule: 'lod1-placement',
      detail: `${lod1Name} must be a top-level node, next to ${rootName}`,
    });
  }
  if (lod1) {
    let withExtras = 0;
    lod1.traverse((node) => {
      if (Object.keys(node.getExtras()).length > 0) withExtras++;
    });
    if (withExtras > 0) {
      failures.push({
        rule: 'lod1-extras',
        detail: `${withExtras} node(s) under ${lod1Name} carry extras; the lower level is not bound`,
      });
    }
    const lod1Triangles = triangleCountUnder(lod1);
    if (lod1Triangles > lod0 * BUDGETS.maxLod1Share) {
      failures.push({
        rule: 'lod1-triangles',
        detail: `${lod1Triangles} triangles in ${lod1Name}, at most ${BUDGETS.maxLod1Share * 100} % of ${lod0}`,
      });
    }
  }
  return failures;
}

function checkMaterialsAndTextures(document: Document): Failure[] {
  const failures: Failure[] = [];
  const materials = document.getRoot().listMaterials();
  if (materials.length > BUDGETS.maxMaterials) {
    failures.push({
      rule: 'materials',
      detail: `${materials.length} materials, at most ${BUDGETS.maxMaterials}`,
    });
  }
  for (const material of materials) {
    if (!MATERIAL_LIBRARY.includes(material.getName())) {
      failures.push({
        rule: 'material-name',
        detail: `material ${JSON.stringify(material.getName())} is not in the library (${MATERIAL_LIBRARY.join(', ')})`,
      });
    }
  }

  const textures = document.getRoot().listTextures();
  for (const texture of textures) {
    const label = JSON.stringify(texture.getName() || texture.getURI() || '(unnamed)');
    const image = texture.getImage();
    if (texture.getMimeType() !== KTX2_MIME) {
      failures.push({
        rule: 'texture-format',
        detail: `texture ${label} is ${texture.getMimeType() || 'of unknown type'}, not KTX2`,
      });
      continue;
    }
    const size = image ? ktx2Size(image) : null;
    if (!size) {
      failures.push({
        rule: 'texture-format',
        detail: `texture ${label} has no valid KTX2 header`,
      });
    } else if (size.width > BUDGETS.maxTextureSide || size.height > BUDGETS.maxTextureSide) {
      failures.push({
        rule: 'texture-size',
        detail: `texture ${label} is ${size.width} x ${size.height}, at most ${BUDGETS.maxTextureSide} on a side`,
      });
    }
  }
  for (const material of materials) {
    const count = textures.filter((texture) => texture.listParents().includes(material)).length;
    if (count > BUDGETS.maxTexturesPerMaterial) {
      failures.push({
        rule: 'textures-per-material',
        detail: `material ${JSON.stringify(material.getName())} uses ${count} textures, at most ${BUDGETS.maxTexturesPerMaterial}`,
      });
    }
  }
  return failures;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** `extras` on the nodes the console binds: `bind` a point of the class, `motion`, `axis` and `range` as the contract says. */
function checkBindings(
  document: Document,
  rootName: string,
  pointKeys: ReadonlySet<string>,
): Failure[] {
  const failures: Failure[] = [];
  const lod1 = topLevelNodes(document).find((node) => node.getName() === rootName + LOD1_SUFFIX);
  const underLod1 = new Set<Node>();
  lod1?.traverse((node) => void underLod1.add(node));

  for (const node of document.getRoot().listNodes()) {
    if (underLod1.has(node)) continue;
    const extras = node.getExtras();
    const keys = Object.keys(extras);
    const named = JSON.stringify(node.getName() || '(unnamed)');
    const has = (key: string) => extras[key] !== undefined;

    if (!has('bind')) {
      const stray = ['motion', 'axis', 'range', 'label'].filter(has);
      if (stray.length > 0) {
        failures.push({
          rule: 'binding-incomplete',
          detail: `node ${named} has ${stray.join(', ')} but no bind`,
        });
      }
      continue;
    }

    const unknown = keys.filter((key) => !EXTRAS_KEYS.includes(key));
    if (unknown.length > 0) {
      failures.push({
        rule: 'extras-keys',
        detail: `node ${named} has unknown extras ${unknown.join(', ')} (allowed: ${EXTRAS_KEYS.join(', ')})`,
      });
    }
    if (!node.getName()) {
      failures.push({
        rule: 'node-name',
        detail: 'a bound node has no name, so the code cannot find it',
      });
    }
    if (typeof extras.bind !== 'string' || !pointKeys.has(extras.bind)) {
      failures.push({
        rule: 'bind-key',
        detail: `node ${named} binds ${JSON.stringify(extras.bind)}, which is not a point of the class`,
      });
    }

    const motion = extras.motion;
    if (typeof motion !== 'string' || !MOTIONS.includes(motion)) {
      failures.push({
        rule: 'motion',
        detail: `node ${named} has motion ${JSON.stringify(motion)}, one of ${MOTIONS.join(', ')} expected`,
      });
    } else if (MOVING_MOTIONS.includes(motion)) {
      if (typeof extras.axis !== 'string' || !AXES.includes(extras.axis)) {
        failures.push({
          rule: 'axis-range',
          detail: `node ${named} (${motion}) needs an axis, one of ${AXES.join(', ')}; has ${JSON.stringify(extras.axis)}`,
        });
      }
      const range = extras.range;
      const ok =
        Array.isArray(range) &&
        range.length === 2 &&
        isFiniteNumber(range[0]) &&
        isFiniteNumber(range[1]) &&
        range[0] < range[1];
      if (!ok) {
        failures.push({
          rule: 'axis-range',
          detail: `node ${named} (${motion}) needs a range [min, max] with min < max; has ${JSON.stringify(range)}`,
        });
      }
    } else if (has('axis') || has('range')) {
      failures.push({
        rule: 'axis-range',
        detail: `node ${named} (tint) must not have axis or range; it does not move`,
      });
    }

    if (has('label') && (typeof extras.label !== 'string' || extras.label.trim() === '')) {
      failures.push({ rule: 'label', detail: `node ${named} has an empty or non-text label` });
    }
  }
  return failures;
}

/** Node names are unique across the file (the code finds a part with `getObjectByName`). */
function checkNodeNames(document: Document): Failure[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const node of document.getRoot().listNodes()) {
    const name = node.getName();
    if (name === '') continue;
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  return [...repeated].sort().map((name) => ({
    rule: 'node-names',
    detail: `the name ${JSON.stringify(name)} is used more than once`,
  }));
}

/** The class root: exactly one top-level node named for the class, and no other top-level node but its LOD1. */
function checkClassRoot(document: Document, rootName: string): Failure[] {
  const top = topLevelNodes(document);
  const failures: Failure[] = [];
  if (!top.some((node) => node.getName() === rootName)) {
    failures.push({
      rule: 'class-root',
      detail: `no top-level node named ${rootName}; found ${top.map((node) => JSON.stringify(node.getName())).join(', ') || 'none'}`,
    });
  }
  for (const node of top) {
    const name = node.getName();
    if (name !== rootName && name !== rootName + LOD1_SUFFIX) {
      failures.push({
        rule: 'class-root',
        detail: `unexpected top-level node ${JSON.stringify(name)}; only ${rootName} and ${rootName + LOD1_SUFFIX} are allowed`,
      });
    }
  }
  return failures;
}

export interface ModelToCheck {
  document: Document;
  json: GlbJson;
  /** The class the file's name says it is for; its root name and points come from it. */
  classCode: string;
  /** The keys of the class's telemetry points, from the catalogue. */
  pointKeys: ReadonlySet<string>;
}

/** Every rule that needs the model's content, in a fixed order so the log reads the same each time. */
export function checkModel({ document, json, classCode, pointKeys }: ModelToCheck): Failure[] {
  const rootName = rootNameOf(classCode);
  return [
    ...checkClassRoot(document, rootName),
    ...checkNodeNames(document),
    ...checkLevelsOfDetail(document, rootName),
    ...checkMaterialsAndTextures(document),
    ...checkGeometryCompression(json),
    ...checkBindings(document, rootName, pointKeys),
  ];
}
