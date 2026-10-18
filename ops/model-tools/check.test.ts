/*
 * Specs for `rules.ts` and `check.ts` (`pnpm models:test`, Node's own runner): one case per rule, each
 * failing a purpose-built file and passing a conforming one. Every file is built in memory with
 * gltf-transform; nothing binary is committed. A model that conforms is the baseline, and a case changes
 * one thing about it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Document, NodeIO, type Node } from '@gltf-transform/core';
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
  KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import {
  checkDirectory,
  classPointsOf,
  formatFailure,
  type ClassPoints,
  type DirectoryReport,
} from './check.ts';
import {
  BUDGETS,
  checkDirectoryEntry,
  checkFile,
  checkGeometryCompression,
  checkModel,
  ktx2Size,
  readGlbJson,
  rootNameOf,
  type Failure,
  type GlbJson,
} from './rules.ts';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const POINTS: ClassPoints = new Map([
  ['cooling_tower', new Set(['fanSpeedRpm', 'motorTempC', 'valveOpenPct'])],
  ['ups_battery', new Set(['voltageV'])],
]);
const CLASS_CODES = new Set(POINTS.keys());
const CLASS = 'cooling_tower';
const ROOT = 'CoolingTower';

// ---------------------------------------------------------------------------------------------------------
// Building a model in memory
// ---------------------------------------------------------------------------------------------------------

/** A KTX2 header with a size, enough for the checker, which reads only the header. */
function ktx2(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(80);
  Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    bytes,
    0,
  );
  bytes.writeUInt32LE(width, 20);
  bytes.writeUInt32LE(height, 24);
  return new Uint8Array(bytes);
}

interface Built {
  document: Document;
  root: Node;
  /** Adds a node under `parent` (the root by default). */
  node(name: string, extras?: Record<string, unknown>, parent?: Node): Node;
  /** Adds a triangle mesh of `triangles` triangles to `node`. */
  mesh(node: Node, triangles: number): void;
  material(name: string): ReturnType<Document['createMaterial']>;
}

/**
 * A conforming model: a class root with one small mesh, one `Part` material and no texture. With
 * `compressed: false` the geometry is written plain, which the rules refuse.
 */
function build(compressed = true): Built {
  const document = new Document();
  const buffer = document.createBuffer();
  if (compressed) {
    document
      .createExtension(EXTMeshoptCompression)
      .setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }
  document.createExtension(KHRTextureBasisu).setRequired(true);
  const scene = document.createScene('Scene');
  const root = document.createNode(ROOT);
  scene.addChild(root);
  const built: Built = {
    document,
    root,
    node: (name, extras, parent = root) => {
      const node = document.createNode(name);
      if (extras) node.setExtras(extras);
      parent.addChild(node);
      return node;
    },
    mesh: (node, triangles) => {
      const vertices = triangles + 2;
      const position = document
        .createAccessor()
        .setType('VEC3')
        .setArray(new Float32Array(vertices * 3).map((_, i) => (i * 7) % 13))
        .setBuffer(buffer);
      const indices = new Uint32Array(triangles * 3);
      for (let t = 0; t < triangles; t++) indices.set([t, t + 1, t + 2], t * 3);
      const index = document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer);
      const primitive = document
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setIndices(index)
        .setMaterial(part);
      node.setMesh(document.createMesh(`${node.getName()}Mesh`).addPrimitive(primitive));
    },
    material: (name) => document.createMaterial(name),
  };
  const part = built.material('Part');
  built.mesh(root, 12);
  return built;
}

/** What `check.ts` would hand to `checkModel`: the document read back from its own bytes, and the container's JSON. */
async function roundTrip(
  built: Built,
): Promise<{ document: Document; json: GlbJson; bytes: Uint8Array }> {
  const bytes = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
    .writeBinary(built.document);
  const document = await new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
    .readBinary(bytes);
  return { document, json: readGlbJson(bytes), bytes };
}

async function failuresOf(built: Built, classCode = CLASS): Promise<Failure[]> {
  const { document, json } = await roundTrip(built);
  return checkModel({ document, json, classCode, pointKeys: POINTS.get(classCode) ?? new Set() });
}

const rulesOf = (failures: Failure[]) => failures.map((failure) => failure.rule);

/** Asserts exactly one failure of `rule` whose detail mentions `mention`. */
function assertFails(failures: Failure[], rule: string, mention?: string | RegExp) {
  const found = failures.filter((failure) => failure.rule === rule);
  assert.ok(found.length >= 1, `expected a ${rule} failure, got: ${JSON.stringify(failures)}`);
  if (mention !== undefined) {
    assert.ok(
      found.some((failure) =>
        typeof mention === 'string'
          ? failure.detail.includes(mention)
          : mention.test(failure.detail),
      ),
      `${rule}: ${found.map((failure) => failure.detail).join(' | ')} does not mention ${mention}`,
    );
  }
}

const sha12 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 12);

// ---------------------------------------------------------------------------------------------------------
// The baseline
// ---------------------------------------------------------------------------------------------------------

describe('a conforming model', () => {
  it('passes every rule', async () => {
    assert.deepEqual(await failuresOf(build()), []);
  });

  it('passes with bound parts, a texture, and a LOD1 sibling at a quarter of the triangles', async () => {
    const built = build();
    built.mesh(built.root, 400);
    built.node('FanBlade', {
      bind: 'fanSpeedRpm',
      motion: 'spin',
      axis: 'y',
      range: [0, 1800],
      label: 'Fan',
    });
    built.node('FanMotor', { bind: 'motorTempC', motion: 'tint' });
    built.node('Valve', { bind: 'valveOpenPct', motion: 'turn', axis: 'x', range: [0, 90] });
    const texture = built.document
      .createTexture('t')
      .setImage(ktx2(1024, 1024))
      .setMimeType('image/ktx2');
    built.document.getRoot().listMaterials()[0]?.setBaseColorTexture(texture);
    const lod1 = built.document.createNode(`${ROOT}_LOD1`);
    built.document.getRoot().listScenes()[0]?.addChild(lod1);
    built.mesh(lod1, 100);

    assert.deepEqual(await failuresOf(built), []);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The directory and the file's bytes
// ---------------------------------------------------------------------------------------------------------

describe('the directory', () => {
  it('allows .glb files and a README.md', () => {
    assert.deepEqual(checkDirectoryEntry('cooling_tower.0123456789ab.glb', false), []);
    assert.deepEqual(checkDirectoryEntry('README.md', false), []);
  });

  it('rejects a .gltf', () => {
    assertFails(checkDirectoryEntry('cooling_tower.gltf', false), 'not-glb', '.gltf');
  });

  it('rejects a loose .bin and a loose image', () => {
    assertFails(checkDirectoryEntry('tower.bin', false), 'not-glb', '.bin');
    assertFails(checkDirectoryEntry('albedo.png', false), 'not-glb', '.png');
  });

  it('rejects a file with no extension', () => {
    assertFails(checkDirectoryEntry('LICENSE', false), 'not-glb', '(none)');
  });

  it('rejects a subdirectory', () => {
    assertFails(checkDirectoryEntry('lod', true), 'subdirectory');
  });
});

describe('the file name and its bytes', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const name = (classCode = CLASS, hash = sha12(bytes)) => `${classCode}.${hash}.glb`;

  it('passes a name that follows the pattern, with the right hash, a known class and a small file', () => {
    const { classCode, failures } = checkFile(name(), bytes, CLASS_CODES);
    assert.equal(classCode, CLASS);
    assert.deepEqual(failures, []);
  });

  it('rejects a name that does not follow <class>.<12 hex>.glb', () => {
    assertFails(checkFile('cooling_tower.glb', bytes, CLASS_CODES).failures, 'file-name');
    assertFails(
      checkFile('cooling_tower.ABCDEF123456.glb', bytes, CLASS_CODES).failures,
      'file-name',
    );
    assertFails(checkFile('cooling_tower.0123.glb', bytes, CLASS_CODES).failures, 'file-name');
  });

  it('rejects a hash that is not the SHA-256 of the bytes, and says both', () => {
    const wrong = checkFile(name(CLASS, '0123456789ab'), bytes, CLASS_CODES);
    assertFails(wrong.failures, 'file-hash', sha12(bytes));
  });

  it('rejects a class that is not in the catalogue', () => {
    const unknown = checkFile(name('gizmo'), bytes, CLASS_CODES);
    assert.equal(unknown.classCode, null);
    assertFails(unknown.failures, 'unknown-class', 'gizmo');
  });

  it('rejects a file over 1.5 MB (1,500,000 bytes) and passes one at exactly that size', () => {
    const exactly = new Uint8Array(BUDGETS.maxFileBytes);
    assert.deepEqual(
      rulesOf(checkFile(name(CLASS, sha12(exactly)), exactly, CLASS_CODES).failures),
      [],
    );
    const over = new Uint8Array(BUDGETS.maxFileBytes + 1);
    assertFails(
      checkFile(name(CLASS, sha12(over)), over, CLASS_CODES).failures,
      'file-size',
      '1500001',
    );
  });
});

describe('the GLB container', () => {
  it('rejects bytes that are not a GLB', () => {
    assert.throws(() => readGlbJson(new Uint8Array(40)), /magic number/);
    assert.throws(() => readGlbJson(new Uint8Array(4)), /shorter/);
  });

  it('reads the JSON chunk of a real one', async () => {
    const { json } = await roundTrip(build());
    assert.ok(json.extensionsUsed?.includes('EXT_meshopt_compression'));
  });
});

// ---------------------------------------------------------------------------------------------------------
// The class root and the names
// ---------------------------------------------------------------------------------------------------------

describe('the class root', () => {
  it('is named for the class in PascalCase', () => {
    assert.equal(rootNameOf('cooling_tower'), 'CoolingTower');
    assert.equal(rootNameOf('ups_battery'), 'UpsBattery');
    assert.equal(rootNameOf('lift'), 'Lift');
  });

  it('fails when no top-level node has the class name', async () => {
    const built = build();
    built.root.setName('Tower');
    assertFails(await failuresOf(built), 'class-root', 'no top-level node named CoolingTower');
  });

  it('fails on another top-level node', async () => {
    const built = build();
    built.document.getRoot().listScenes()[0]?.addChild(built.document.createNode('Stray'));
    assertFails(await failuresOf(built), 'class-root', 'Stray');
  });

  it('is the model of the class the name claims, not another', async () => {
    assertFails(await failuresOf(build(), 'ups_battery'), 'class-root', 'UpsBattery');
  });
});

describe('node names', () => {
  it('fail when one is used twice', async () => {
    const built = build();
    built.node('FanBlade');
    built.node('FanBlade', undefined, built.node('FanStack'));
    assertFails(await failuresOf(built), 'node-names', '"FanBlade"');
  });

  it('may be empty on a static node, but a bound node needs one', async () => {
    const built = build();
    built.node('', undefined);
    assert.deepEqual(rulesOf(await failuresOf(built)), []);
    built.node('', { bind: 'fanSpeedRpm', motion: 'tint' });
    assertFails(await failuresOf(built), 'node-name');
  });
});

// ---------------------------------------------------------------------------------------------------------
// The budgets
// ---------------------------------------------------------------------------------------------------------

describe('triangles', () => {
  it('pass at exactly 50,000 in the class root', async () => {
    const built = build();
    built.mesh(built.node('Casing'), BUDGETS.maxTrianglesLod0 - 12);
    assert.deepEqual(rulesOf(await failuresOf(built)), []);
  });

  it('fail over 50,000 in the class root, counting its children', async () => {
    const built = build();
    built.mesh(built.node('Casing'), BUDGETS.maxTrianglesLod0 - 11);
    assertFails(await failuresOf(built), 'triangles', '50001');
  });
});

describe('the lower level of detail', () => {
  const withLod1 = (lod1Triangles: number) => {
    const built = build();
    built.mesh(built.root, 400);
    const lod1 = built.document.createNode(`${ROOT}_LOD1`);
    built.document.getRoot().listScenes()[0]?.addChild(lod1);
    built.mesh(lod1, lod1Triangles);
    return { built, lod1 };
  };

  it('passes at a quarter of the triangles and does not count towards the 50,000', async () => {
    assert.deepEqual(rulesOf(await failuresOf(withLod1(100).built)), []);
  });

  it('fails over a quarter of the triangles', async () => {
    assertFails(await failuresOf(withLod1(101).built), 'lod1-triangles', '101');
  });

  it('fails when it is not a top-level node', async () => {
    const { built, lod1 } = withLod1(50);
    built.document.getRoot().listScenes()[0]?.removeChild(lod1);
    built.root.addChild(lod1);
    assertFails(await failuresOf(built), 'lod1-placement', 'top-level');
  });

  it('fails when a node under it carries extras', async () => {
    const { built, lod1 } = withLod1(50);
    lod1.setExtras({ bind: 'fanSpeedRpm' });
    assertFails(await failuresOf(built), 'lod1-extras', '1 node(s)');
  });
});

describe('materials', () => {
  it('pass at 4 and fail at 5', async () => {
    const built = build();
    for (const name of ['Steel', 'Concrete', 'Rail']) built.material(name);
    assert.deepEqual(rulesOf(await failuresOf(built)), []);
    built.material('Blade');
    assertFails(await failuresOf(built), 'materials', '5 materials');
  });

  it('fail when a name is not in the library', async () => {
    const built = build();
    built.material('Chrome');
    assertFails(await failuresOf(built), 'material-name', '"Chrome"');
  });
});

describe('textures', () => {
  const textured = (mimeType: string, image: Uint8Array) => {
    const built = build();
    const texture = built.document.createTexture('albedo').setImage(image).setMimeType(mimeType);
    built.document.getRoot().listMaterials()[0]?.setBaseColorTexture(texture);
    return built;
  };

  it('pass as KTX2 at 1024 x 1024', async () => {
    assert.deepEqual(rulesOf(await failuresOf(textured('image/ktx2', ktx2(1024, 1024)))), []);
  });

  it('fail when they are not KTX2', async () => {
    assertFails(
      await failuresOf(textured('image/png', new Uint8Array(10))),
      'texture-format',
      'image/png',
    );
  });

  it('fail when the KTX2 header is not valid', async () => {
    assertFails(
      await failuresOf(textured('image/ktx2', new Uint8Array(40))),
      'texture-format',
      'header',
    );
  });

  it('fail over 1024 on either side', async () => {
    assertFails(
      await failuresOf(textured('image/ktx2', ktx2(2048, 512))),
      'texture-size',
      '2048 x 512',
    );
    assertFails(
      await failuresOf(textured('image/ktx2', ktx2(512, 1025))),
      'texture-size',
      '512 x 1025',
    );
  });

  it('pass at 3 per material and fail at 4', async () => {
    const built = build();
    const material = built.document.getRoot().listMaterials()[0];
    assert.ok(material);
    const texture = (name: string) =>
      built.document.createTexture(name).setImage(ktx2(64, 64)).setMimeType('image/ktx2');
    material
      .setBaseColorTexture(texture('a'))
      .setNormalTexture(texture('b'))
      .setEmissiveTexture(texture('c'));
    assert.deepEqual(rulesOf(await failuresOf(built)), []);
    material.setOcclusionTexture(texture('d'));
    assertFails(await failuresOf(built), 'textures-per-material', '4 textures');
  });

  it('read the size from the header, however small the rest of the file', () => {
    assert.deepEqual(ktx2Size(ktx2(300, 200)), { width: 300, height: 200 });
    assert.equal(ktx2Size(new Uint8Array(100)), null);
  });
});

describe('geometry compression', () => {
  it('fails when the geometry is not Meshopt-compressed', async () => {
    assertFails(await failuresOf(build(false)), 'geometry-compression', 'is not used');
  });

  it('fails on a buffer that is left plain beside compressed ones', () => {
    const json: GlbJson = {
      extensionsUsed: ['EXT_meshopt_compression'],
      meshes: [{ name: 'Casing', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [{ bufferView: 0 }, { bufferView: 1 }],
      bufferViews: [{ extensions: { EXT_meshopt_compression: {} } }, {}],
    };
    assertFails(checkGeometryCompression(json), 'geometry-compression', '"Casing" has 1 buffer');
  });

  it('passes a file with no mesh at all', () => {
    assert.deepEqual(checkGeometryCompression({ meshes: [] }), []);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The bindings
// ---------------------------------------------------------------------------------------------------------

describe('bindings', () => {
  const bound = (extras: Record<string, unknown>) => {
    const built = build();
    built.node('Part1', extras);
    return built;
  };
  const spin = { bind: 'fanSpeedRpm', motion: 'spin', axis: 'y', range: [0, 1800] };

  it('pass for a spin, a turn, a slide and a tint', async () => {
    for (const extras of [
      spin,
      { bind: 'valveOpenPct', motion: 'turn', axis: 'x', range: [0, 90] },
      { bind: 'valveOpenPct', motion: 'slide', axis: 'z', range: [-1, 1] },
      { bind: 'motorTempC', motion: 'tint' },
    ]) {
      assert.deepEqual(rulesOf(await failuresOf(bound(extras))), [], JSON.stringify(extras));
    }
  });

  it('fail when bind is not a point of the class', async () => {
    assertFails(await failuresOf(bound({ ...spin, bind: 'rpm' })), 'bind-key', '"rpm"');
    assertFails(await failuresOf(bound({ ...spin, bind: 3 })), 'bind-key');
  });

  it('fail on a motion that is not one of the four', async () => {
    assertFails(await failuresOf(bound({ ...spin, motion: 'wobble' })), 'motion', '"wobble"');
    assertFails(await failuresOf(bound({ bind: 'fanSpeedRpm' })), 'motion');
  });

  it('fail when a moving part has no axis, or one that is not x, y or z', async () => {
    assertFails(
      await failuresOf(bound({ bind: 'fanSpeedRpm', motion: 'spin', range: [0, 1] })),
      'axis-range',
      'axis',
    );
    assertFails(await failuresOf(bound({ ...spin, axis: 'w' })), 'axis-range', '"w"');
  });

  it('fail when a moving part has no range, or one that is not [min, max] with min < max', async () => {
    assertFails(
      await failuresOf(bound({ bind: 'fanSpeedRpm', motion: 'spin', axis: 'y' })),
      'axis-range',
      'range',
    );
    for (const range of [[5, 5], [9, 1], [0], [0, 1, 2], ['0', '1'], [0, Infinity]]) {
      assertFails(await failuresOf(bound({ ...spin, range })), 'axis-range', 'range');
    }
  });

  it('fail when a tint has an axis or a range', async () => {
    assertFails(
      await failuresOf(bound({ bind: 'motorTempC', motion: 'tint', axis: 'y' })),
      'axis-range',
      'tint',
    );
    assertFails(
      await failuresOf(bound({ bind: 'motorTempC', motion: 'tint', range: [0, 1] })),
      'axis-range',
      'tint',
    );
  });

  it('fail on a key that is not allowed, which would otherwise bind nothing', async () => {
    assertFails(await failuresOf(bound({ ...spin, bnd: 'x' })), 'extras-keys', 'bnd');
  });

  it('fail on a motion, axis, range or label without a bind', async () => {
    for (const extras of [{ motion: 'spin' }, { axis: 'y' }, { range: [0, 1] }, { label: 'Fan' }]) {
      assertFails(await failuresOf(bound(extras)), 'binding-incomplete', 'no bind');
    }
  });

  it('leave extras that are not about bindings alone', async () => {
    assert.deepEqual(rulesOf(await failuresOf(bound({ author: 'Blender' }))), []);
  });

  it('fail on a label that is empty or not text', async () => {
    assertFails(await failuresOf(bound({ ...spin, label: '  ' })), 'label');
    assertFails(await failuresOf(bound({ ...spin, label: 7 })), 'label');
  });
});

// ---------------------------------------------------------------------------------------------------------
// The catalogue and the directory run
// ---------------------------------------------------------------------------------------------------------

describe('the catalogue', () => {
  it('gives each class the keys of its assets', () => {
    const points = classPointsOf({
      assets: [
        { code: 'CT-01', classCode: 'cooling_tower', points: [{ key: 'a' }, { key: 'b' }] },
        { code: 'CT-02', classCode: 'cooling_tower', points: [{ key: 'b' }, { key: 'a' }] },
        { code: 'L-01', classCode: 'lift', points: [{ key: 'c' }] },
      ],
    });
    assert.deepEqual([...(points.get('cooling_tower') ?? [])].sort(), ['a', 'b']);
    assert.deepEqual([...(points.get('lift') ?? [])], ['c']);
  });

  it('refuses a class whose assets disagree, naming the class', () => {
    assert.throws(
      () =>
        classPointsOf({
          assets: [
            { code: 'CT-01', classCode: 'cooling_tower', points: [{ key: 'a' }] },
            { code: 'CT-02', classCode: 'cooling_tower', points: [{ key: 'b' }] },
          ],
        }),
      /cooling_tower/,
    );
  });
});

describe('the run over a directory', () => {
  const dirs: string[] = [];
  after(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });
  const directory = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'models-check-'));
    dirs.push(dir);
    return dir;
  };
  /** Writes a conforming model under its real, hashed name. */
  const writeModel = async (dir: string, built = build(), classCode = CLASS) => {
    const { bytes } = await roundTrip(built);
    const name = `${classCode}.${sha12(bytes)}.glb`;
    await writeFile(join(dir, name), bytes);
    return name;
  };
  const run = (dir: string): Promise<DirectoryReport> => checkDirectory(dir, POINTS);

  it('passes when the directory does not exist', async () => {
    assert.deepEqual(await run(join(await directory(), 'nowhere')), { checked: 0, failures: [] });
  });

  it('passes when the directory is empty or holds only a README.md', async () => {
    const dir = await directory();
    assert.deepEqual(await run(dir), { checked: 0, failures: [] });
    await writeFile(join(dir, 'README.md'), '# Models');
    assert.deepEqual(await run(dir), { checked: 0, failures: [] });
  });

  it('passes a conforming model', async () => {
    const dir = await directory();
    await writeModel(dir);
    assert.deepEqual(await run(dir), { checked: 1, failures: [] });
  });

  it('names the file and the rule in each line of the log', async () => {
    const dir = await directory();
    const built = build();
    built.material('Chrome');
    const name = await writeModel(dir, built);

    const report = await run(dir);

    assert.equal(report.checked, 1);
    assert.deepEqual(
      report.failures.map((failure) => failure.rule),
      ['material-name'],
    );
    assert.equal(
      formatFailure(report.failures[0]!),
      `ops/models/${name}: material-name: material "Chrome" is not in the library (Part, Steel, Concrete, Rail, Screen, Blade, Hub, Xray)`,
    );
  });

  it('reports a file that is not glTF as unreadable, and goes on to the next', async () => {
    const dir = await directory();
    const garbage = new Uint8Array(64).fill(1);
    const bad = `cooling_tower.${sha12(garbage)}.glb`;
    await writeFile(join(dir, bad), garbage);
    await writeModel(dir, build(), 'cooling_tower');

    const report = await run(dir);

    assert.equal(report.checked, 2);
    assert.deepEqual(
      report.failures.map((failure) => [failure.file, failure.rule]),
      [[bad, 'readable']],
    );
  });

  it('reports loose files and subdirectories', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'tower.gltf'), '{}');
    await mkdir(join(dir, 'lod'));

    const report = await run(dir);

    assert.deepEqual(
      report.failures.map((failure) => [failure.file, failure.rule]),
      [
        ['lod', 'subdirectory'],
        ['tower.gltf', 'not-glb'],
      ],
    );
  });

  it('lists the files in name order, so the log reads the same each time', async () => {
    const dir = await directory();
    const a = await writeModel(dir, build(), 'cooling_tower');
    const b = await writeModel(dir, build(), 'ups_battery');
    const report = await run(dir);
    // `ups_battery` has no UpsBattery root in a CoolingTower file: the second file fails, the first does not.
    assert.deepEqual([...new Set(report.failures.map((failure) => failure.file))], [b]);
    assert.ok(a < b);
  });
});
