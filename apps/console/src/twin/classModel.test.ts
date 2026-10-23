import {
  BoxGeometry,
  BufferGeometry,
  Frustum,
  Group,
  Int16BufferAttribute,
  LineBasicMaterial,
  type LineSegments,
  type LOD,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Vector3,
} from 'three';
import { HOME_FOV_DEG, LOD_HYSTERESIS, lodDistance } from '../lib/twin-core/twinCamera';
import {
  EDGE_DASH_M,
  EDGE_GAP_M,
  GHOST_OPACITY,
  mixInto,
  tintFor,
} from '../lib/twin-core/twinMaterials';
import { mapColors, twinColors } from '../styles/tokens';
import {
  buildTemplate,
  createMaterialTable,
  instantiate,
  nodeInfoOf,
  OUTLINE_NAME,
} from './classModel';

/*
 * The scenes below are what glTF's loader returns, made by hand: a `scene` holding the class root and its
 * `_LOD1` sibling, nodes named for parts, `extras` on `userData`, a vendor material named for a console one.
 * Three's scene graph needs no WebGL, so this runs in jsdom.
 */

/** A mesh of a 1 m cube (24 vertices) in a vendor material called `material`. */
function part(
  name: string,
  material: string,
  at: [number, number, number] = [0, 0, 0],
  extras?: Record<string, unknown>,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: material }));
  mesh.name = name;
  mesh.position.set(...at);
  if (extras) mesh.userData = extras;
  return mesh;
}

function group(name: string, at: [number, number, number] = [0, 0, 0]): Group {
  const node = new Group();
  node.name = name;
  node.position.set(...at);
  return node;
}

/** What the loader returns: the scene, the class root, and an LOD1 sibling. */
function scene(root: Object3D, lod1: Object3D = part('Root_LOD1', 'Part')): Group {
  const loaded = new Group();
  loaded.add(root, lod1);
  return loaded;
}

const world = (object: Object3D): Vector3 => object.getWorldPosition(new Vector3());

/** A position equal to `expected` to within rounding, so a stray −0 does not fail it. */
function expectNear(actual: Vector3, expected: [number, number, number]): void {
  expect(actual.x).toBeCloseTo(expected[0], 9);
  expect(actual.y).toBeCloseTo(expected[1], 9);
  expect(actual.z).toBeCloseTo(expected[2], 9);
}

/** The merged static meshes of a template by console material. */
const staticMeshes = (root: Object3D): Mesh[] =>
  root.children.filter((child): child is Mesh => child.name.startsWith('_static_'));

const FAN = { bind: 'fanSpeedRpm', motion: 'spin', axis: 'y', range: [0, 1800] };
const VALVE = { bind: 'valveOpenPct', motion: 'turn', axis: 'x', range: [0, 90] };
const TINT = { bind: 'motorTempC', motion: 'tint' };

describe('createMaterialTable', () => {
  it('gives the console’s material for a name, one per name', () => {
    const table = createMaterialTable();

    const steel = table.get('Steel');
    expect(steel).toBeInstanceOf(MeshLambertMaterial);
    expect(steel.color.getHexString()).toBe(twinColors.steel.top.slice(1));
    expect(table.get('Steel')).toBe(steel);
    expect(table.get('Part')).not.toBe(steel);
  });

  it('falls back to Part for a name it does not know, or none', () => {
    const table = createMaterialTable();

    expect(table.get('Chrome')).toBe(table.get('Part'));
    expect(table.get(undefined)).toBe(table.get('Part'));
    expect(table.get('Chrome').name).toBe('Part');
  });

  it('makes Xray see-through and the others solid', () => {
    const table = createMaterialTable();

    expect(table.get('Xray')).toMatchObject({
      transparent: true,
      opacity: twinColors.xrayOpacity,
      depthWrite: false,
    });
    expect(table.get('Part')).toMatchObject({ transparent: false, opacity: 1, depthWrite: true });
  });

  it('frees its materials', () => {
    const table = createMaterialTable();
    const dispose = vi.spyOn(table.get('Part'), 'dispose');

    table.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('nodeInfoOf', () => {
  it('reads the name, the extras from userData and the children, in depth', () => {
    const root = group('Root');
    const stack = group('Stack');
    stack.add(part('Fan', 'Blade', [0, 0, 0], FAN));
    root.add(stack);

    expect(nodeInfoOf(root)).toEqual({
      name: 'Root',
      extras: {},
      children: [
        {
          name: 'Stack',
          extras: {},
          children: [{ name: 'Fan', extras: FAN, children: [] }],
        },
      ],
    });
  });
});

describe('buildTemplate', () => {
  it('uses the class root, not the LOD1 sibling, and names the template for it', () => {
    const root = group('CoolingTower');
    root.add(part('Casing', 'Part'));

    const template = buildTemplate(
      scene(root, part('CoolingTower_LOD1', 'Part')),
      createMaterialTable(),
    );

    expect(template.root.name).toBe('CoolingTower');
    expect(template.root.getObjectByName('CoolingTower_LOD1')).toBeUndefined();
    expect(staticMeshes(template.root)).toHaveLength(1);
  });

  it('throws when the scene has no class root, so the class stays a box', () => {
    expect(() => buildTemplate(new Group(), createMaterialTable())).toThrow(/no class root/);
    expect(() =>
      buildTemplate(scene(group('X_LOD1'), part('Y_LOD1', 'Part')), createMaterialTable()),
    ).toThrow(/no class root/);
  });

  describe('materials', () => {
    it('replaces the vendor’s by name, and an unknown name by Part', () => {
      const table = createMaterialTable();
      const root = group('Root');
      root.add(part('Valve', 'Steel', [0, 0, 0], VALVE), part('Pipe', 'Chrome', [1, 0, 0], TINT));

      const template = buildTemplate(scene(root), table);

      expect((template.root.getObjectByName('Valve') as Mesh).material).toBe(table.get('Steel'));
      expect((template.root.getObjectByName('Pipe') as Mesh).material).toBe(table.get('Part'));
    });

    it('frees the vendor’s materials, which nothing uses any more', () => {
      const root = group('Root');
      const casing = part('Casing', 'Part');
      const valve = part('Valve', 'Steel', [0, 0, 0], VALVE);
      root.add(casing, valve);
      const vendor = [casing, valve].map((node) => node.material as MeshStandardMaterial);
      const disposed = vendor.map((material) => vi.spyOn(material, 'dispose'));

      buildTemplate(scene(root), createMaterialTable());

      for (const spy of disposed) expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('static parts', () => {
    it('merges them into one mesh per console material, with their transform baked in', () => {
      const table = createMaterialTable();
      const root = group('Root');
      const stack = group('Stack', [10, 0, 0]);
      stack.add(part('Riser', 'Part', [0, 3, 0]));
      root.add(part('Casing', 'Part', [-2, 0, 0]), part('Pipe', 'Steel', [0, 0, 5]), stack);

      const template = buildTemplate(scene(root), table);

      const meshes = staticMeshes(template.root);
      expect(meshes.map((mesh) => mesh.name).sort()).toEqual(['_static_Part', '_static_Steel']);
      const partMesh = meshes.find((mesh) => mesh.name === '_static_Part')!;
      expect(partMesh.material).toBe(table.get('Part'));
      expect(partMesh.geometry.getAttribute('position').count).toBe(48);
      partMesh.geometry.computeBoundingBox();
      // Casing at x = −2 and Riser at (10, 3, 0): the box reaches both, 0.5 m beyond each centre.
      expect(partMesh.geometry.boundingBox!.min.toArray()).toEqual([-2.5, -0.5, -0.5]);
      expect(partMesh.geometry.boundingBox!.max.toArray()).toEqual([10.5, 3.5, 0.5]);
    });

    it('keeps only positions and normals, as floats, indexed', () => {
      const root = group('Root');
      root.add(part('Casing', 'Part'), part('Pipe', 'Part', [2, 0, 0]));

      const template = buildTemplate(scene(root), createMaterialTable());

      const geometry = staticMeshes(template.root)[0]!.geometry;
      expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position']);
      expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
      expect(geometry.index).not.toBeNull();
      expect(geometry.index!.count).toBe(72);
    });

    it('merges a quantised model through its node’s scale', () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Int16BufferAttribute([-32767, 0, 0, 32767, 0, 0, 0, 32767, 0], 3, true),
      );
      const quantised = new Mesh(geometry, new MeshStandardMaterial({ name: 'Part' }));
      quantised.name = 'Casing';
      quantised.scale.set(5, 5, 5);
      const root = group('Root');
      root.add(quantised);

      const template = buildTemplate(scene(root), createMaterialTable());

      const merged = staticMeshes(template.root)[0]!.geometry;
      merged.computeBoundingBox();
      expect(merged.boundingBox!.min.x).toBeCloseTo(-5, 4);
      expect(merged.boundingBox!.max.x).toBeCloseTo(5, 4);
      expect(merged.boundingBox!.max.y).toBeCloseTo(5, 4);
    });

    it('is relative to the class root, whatever the root’s own transform', () => {
      const root = group('Root', [100, 0, 0]);
      root.add(part('Casing', 'Part', [3, 0, 0]));

      const template = buildTemplate(scene(root), createMaterialTable());

      const merged = staticMeshes(template.root)[0]!.geometry;
      merged.computeBoundingBox();
      expect(merged.boundingBox!.min.x).toBeCloseTo(2.5, 6);
      expect(merged.boundingBox!.max.x).toBeCloseTo(3.5, 6);
    });

    it('leaves no static mesh of the original, and frees the originals and LOD1', () => {
      const root = group('Root');
      const casing = part('Casing', 'Part');
      root.add(casing);
      const lod1 = part('Root_LOD1', 'Part');
      const spies = [vi.spyOn(casing.geometry, 'dispose'), vi.spyOn(lod1.geometry, 'dispose')];

      const template = buildTemplate(scene(root, lod1), createMaterialTable());

      expect(template.root.getObjectByName('Casing')).toBeUndefined();
      for (const spy of spies) expect(spy).toHaveBeenCalled();
    });

    it('has no static mesh when every part is bound', () => {
      const root = group('Root');
      root.add(part('Fan', 'Blade', [0, 0, 0], FAN));

      const template = buildTemplate(scene(root), createMaterialTable());

      expect(staticMeshes(template.root)).toHaveLength(0);
      expect(template.root.getObjectByName('Fan')).toBeDefined();
    });
  });

  describe('bound parts', () => {
    it('stay separate and keep their world position when their static parent is merged away', () => {
      const root = group('Root');
      const stack = group('FanStack', [10, 0, 0]);
      stack.add(part('Casing', 'Part'), part('FanBlade', 'Blade', [0, 2, 0], FAN));
      root.add(stack);

      const template = buildTemplate(scene(root), createMaterialTable());
      template.root.updateMatrixWorld(true);

      const fan = template.root.getObjectByName('FanBlade')!;
      expect(fan.parent).toBe(template.root);
      expectNear(world(fan), [10, 2, 0]);
      expect(fan.userData).toEqual(FAN);
      expect(template.root.getObjectByName('FanStack')).toBeUndefined();
    });

    it('keep the world rotation and scale of a turned parent, too', () => {
      const root = group('Root');
      const panel = group('Panel');
      panel.rotation.y = Math.PI / 2;
      panel.scale.set(2, 2, 2);
      panel.add(part('Switch', 'Steel', [1, 0, 0], VALVE));
      root.add(panel);

      const template = buildTemplate(scene(root), createMaterialTable());
      template.root.updateMatrixWorld(true);

      // (1, 0, 0) scaled by 2 and turned a quarter about +y is (0, 0, −2).
      expectNear(world(template.root.getObjectByName('Switch')!), [0, 0, -2]);
    });

    it('keep their own children, static or bound, under them, and do not merge those', () => {
      const root = group('Root');
      const panel = part('ControlPanel', 'Part', [4, 0, 0], TINT);
      panel.add(part('Label', 'Part', [0, 1, 0]), part('Breaker', 'Steel', [0, 0, 1], VALVE));
      root.add(panel);

      const template = buildTemplate(scene(root), createMaterialTable());
      template.root.updateMatrixWorld(true);

      const kept = template.root.getObjectByName('ControlPanel')!;
      expect(kept.parent).toBe(template.root);
      expect(kept.getObjectByName('Label')!.parent).toBe(kept);
      expect(kept.getObjectByName('Breaker')!.parent).toBe(kept);
      expectNear(world(kept.getObjectByName('Breaker')!), [4, 0, 1]);
      expect(staticMeshes(template.root)).toHaveLength(0);
    });

    it('get the console’s materials, including the ones under another bound part', () => {
      const table = createMaterialTable();
      const root = group('Root');
      const panel = part('ControlPanel', 'Part', [0, 0, 0], TINT);
      panel.add(part('Breaker', 'Steel', [0, 0, 1], VALVE));
      root.add(panel);

      const template = buildTemplate(scene(root), table);

      expect((template.root.getObjectByName('Breaker') as Mesh).material).toBe(table.get('Steel'));
    });
  });

  it('records the nodes as they were before the merge, for the bindings', () => {
    const root = group('Root');
    const stack = group('FanStack');
    stack.add(part('FanBlade', 'Blade', [0, 0, 0], FAN));
    root.add(stack, part('Casing', 'Part'));

    const { info } = buildTemplate(scene(root), createMaterialTable());

    expect(info.name).toBe('Root');
    expect(info.children?.map((child) => child.name)).toEqual(['FanStack', 'Casing']);
    expect(info.children?.[0]?.children?.[0]).toMatchObject({ name: 'FanBlade', extras: FAN });
  });

  it('frees the merged geometry on dispose', () => {
    const root = group('Root');
    root.add(part('Casing', 'Part'));
    const template = buildTemplate(scene(root), createMaterialTable());
    const dispose = vi.spyOn(staticMeshes(template.root)[0]!.geometry, 'dispose');

    template.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('instantiate', () => {
  function template() {
    const root = group('CoolingTower');
    root.add(part('Casing', 'Part'), part('FanBlade', 'Blade', [0, 2, 0], FAN));
    return buildTemplate(scene(root), createMaterialTable());
  }

  it('shares the geometry and the materials with the template and every other copy', () => {
    const made = template();
    const one = instantiate(made);
    const two = instantiate(made);

    const [oneStatic] = staticMeshes(one);
    const [twoStatic] = staticMeshes(two);
    expect(oneStatic!.geometry).toBe(twoStatic!.geometry);
    expect(oneStatic!.geometry).toBe(staticMeshes(made.root)[0]!.geometry);
    expect(oneStatic!.material).toBe(twoStatic!.material);
    const fan = one.getObjectByName('FanBlade') as Mesh;
    expect(fan.geometry).toBe((two.getObjectByName('FanBlade') as Mesh).geometry);
    expect(fan.material).toBe((two.getObjectByName('FanBlade') as Mesh).material);
  });

  it('gives each copy its own bound parts, found by name', () => {
    const made = template();
    const one = instantiate(made);
    const two = instantiate(made);

    const fanOne = one.getObjectByName('FanBlade')!;
    const fanTwo = two.getObjectByName('FanBlade')!;
    expect(fanOne).not.toBe(fanTwo);
    expect(fanOne).not.toBe(made.root.getObjectByName('FanBlade'));

    fanOne.rotation.y = 1;
    expect(fanTwo.rotation.y).toBe(0);
    expect(made.root.getObjectByName('FanBlade')!.rotation.y).toBe(0);
  });

  it('gives each copy its own transform', () => {
    const made = template();
    const one = instantiate(made);
    const two = instantiate(made);

    one.position.set(5, 0, 0);

    expect(two.position.x).toBe(0);
    expect(made.root.position.x).toBe(0);
  });
});

// --- looks (V2-14.9) -----------------------------------------------------------------------------------------

const hexOf = (material: MeshLambertMaterial): string => `#${material.color.getHexString()}`;

describe('the look pool of a material table', () => {
  it('is the base material for an idle look', () => {
    const table = createMaterialTable();

    expect(table.look('Steel', { face: 'idle', severity: null })).toBe(table.get('Steel'));
  });

  it('gives one material per name, face and severity, shared by whoever asks', () => {
    const table = createMaterialTable();
    const high = table.look('Steel', { face: 'alarm', severity: 'high' });

    expect(table.look('Steel', { face: 'alarm', severity: 'high' })).toBe(high);
    expect(table.look('Steel', { face: 'alarm', severity: 'low' })).not.toBe(high);
    expect(table.look('Part', { face: 'alarm', severity: 'high' })).not.toBe(high);
    expect(high).not.toBe(table.get('Steel'));
  });

  it('does not tell a stale or hovered face by severity: one material for all of them', () => {
    const table = createMaterialTable();

    expect(table.look('Steel', { face: 'stale', severity: 'high' })).toBe(
      table.look('Steel', { face: 'stale', severity: 'low' }),
    );
    expect(table.look('Steel', { face: 'hover', severity: 'high' })).toBe(
      table.look('Steel', { face: 'hover', severity: null }),
    );
  });

  it('paints each face with the colour the look gives', () => {
    const table = createMaterialTable();

    expect(hexOf(table.look('Steel', { face: 'alarm', severity: 'high' }))).toBe(
      tintFor('high', twinColors.steel.top),
    );
    expect(hexOf(table.look('Part', { face: 'alarm', severity: 'critical' }))).toBe(
      twinColors.alarm.top,
    );
    expect(hexOf(table.look('Steel', { face: 'stale', severity: null }))).toBe(
      twinColors.stale.top,
    );
    expect(hexOf(table.look('Part', { face: 'hover', severity: null }))).toBe(twinColors.hover.top);
    expect(mixInto(twinColors.idle.top, mapColors.accent, 0.3)).toBe(twinColors.hover.top);
  });

  it('keeps a see-through material see-through in every look', () => {
    const table = createMaterialTable();

    for (const face of ['stale', 'hover', 'alarm'] as const) {
      expect(table.look('Xray', { face, severity: 'high' })).toMatchObject({
        transparent: true,
        opacity: twinColors.xrayOpacity,
        depthWrite: false,
      });
    }
  });

  it('is pushed back like the shells, so an outline wins on the edge', () => {
    const table = createMaterialTable();

    expect(table.get('Part')).toMatchObject({ polygonOffset: true, polygonOffsetFactor: 1 });
    expect(table.look('Part', { face: 'stale', severity: null })).toMatchObject({
      polygonOffset: true,
    });
  });

  describe('a ghost look (V2-15.7)', () => {
    it('is a different material from the idle one, and pooled: the same object for whoever asks', () => {
      const table = createMaterialTable();
      const faded = table.look('Steel', { face: 'idle', severity: null, ghost: true });

      expect(faded).not.toBe(table.get('Steel'));
      expect(table.look('Steel', { face: 'idle', severity: null, ghost: true })).toBe(faded);
      expect(table.look('Part', { face: 'idle', severity: null, ghost: true })).not.toBe(faded);
    });

    it('is faint, see-through and does not write depth, so it never hides the isolated asset', () => {
      const table = createMaterialTable();

      expect(table.look('Steel', { face: 'idle', severity: null, ghost: true })).toMatchObject({
        transparent: true,
        opacity: GHOST_OPACITY,
        depthWrite: false,
      });
      // The idle material is as it was.
      expect(table.get('Steel')).toMatchObject({
        transparent: false,
        opacity: 1,
        depthWrite: true,
      });
    });

    it('keeps the colour of the face it would have: a faded fault is tinted, a faded stale asset grey', () => {
      const table = createMaterialTable();

      expect(hexOf(table.look('Steel', { face: 'idle', severity: null, ghost: true }))).toBe(
        twinColors.steel.top,
      );
      expect(hexOf(table.look('Steel', { face: 'alarm', severity: 'high', ghost: true }))).toBe(
        tintFor('high', twinColors.steel.top),
      );
      expect(hexOf(table.look('Steel', { face: 'stale', severity: null, ghost: true }))).toBe(
        twinColors.stale.top,
      );
    });

    it('is a different material from the same face as it is, and keeps the severity apart', () => {
      const table = createMaterialTable();
      const plain = table.look('Steel', { face: 'alarm', severity: 'high' });
      const faded = table.look('Steel', { face: 'alarm', severity: 'high', ghost: true });

      expect(faded).not.toBe(plain);
      expect(table.look('Steel', { face: 'alarm', severity: 'low', ghost: true })).not.toBe(faded);
      expect(plain).toMatchObject({ transparent: false, opacity: 1 });
    });

    it('never makes a see-through material more solid', () => {
      const table = createMaterialTable();

      expect(table.look('Xray', { face: 'idle', severity: null, ghost: true }).opacity).toBe(
        Math.min(twinColors.xrayOpacity, GHOST_OPACITY),
      );
    });

    it('is pushed back like the others and is freed with the table', () => {
      const table = createMaterialTable();
      const faded = table.look('Steel', { face: 'idle', severity: null, ghost: true });
      const spy = vi.spyOn(faded, 'dispose');

      expect(faded).toMatchObject({ polygonOffset: true, polygonOffsetFactor: 1 });
      table.dispose();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('gives a solid outline in the colour of each edge, and a dashed one for a stale edge', () => {
    const table = createMaterialTable();

    const idle = table.line({ edge: 'idle', severity: null });
    expect(idle).toBeInstanceOf(LineBasicMaterial);
    expect(idle.color.getHexString()).toBe(twinColors.edge.slice(1));
    expect(table.line({ edge: 'accent', severity: null }).color.getHexString()).toBe(
      mapColors.accent.slice(1),
    );
    const severity = table.line({ edge: 'severity', severity: 'high' });
    expect(severity.color.getHexString()).toBe(mapColors.severity.high.slice(1));
    expect(table.line({ edge: 'severity', severity: 'low' })).not.toBe(severity);

    const dashed = table.line({ edge: 'stale-dashed', severity: null });
    expect(dashed).toMatchObject({
      isLineDashedMaterial: true,
      dashSize: EDGE_DASH_M,
      gapSize: EDGE_GAP_M,
    });
    expect(dashed.color.getHexString()).toBe(twinColors.staleEdge.slice(1));
    expect(idle).not.toHaveProperty('isLineDashedMaterial', true);
  });

  it('shares an outline material by edge, and by severity only for the severity edge', () => {
    const table = createMaterialTable();

    expect(table.line({ edge: 'stale-dashed', severity: 'high' })).toBe(
      table.line({ edge: 'stale-dashed', severity: 'low' }),
    );
    expect(table.line({ edge: 'severity', severity: 'high' })).toBe(
      table.line({ edge: 'severity', severity: 'high' }),
    );
  });

  it('frees the whole pool with the table', () => {
    const table = createMaterialTable();
    const alarmed = table.look('Steel', { face: 'alarm', severity: 'high' });
    const dashed = table.line({ edge: 'stale-dashed', severity: null });
    const spies = [vi.spyOn(alarmed, 'dispose'), vi.spyOn(dashed, 'dispose')];

    table.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

const outlinesOf = (object: Object3D): LineSegments[] => {
  const found: LineSegments[] = [];
  object.traverse((node) => {
    if (node.name === OUTLINE_NAME) found.push(node as LineSegments);
  });
  return found;
};

const meshesOf = (object: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  object.traverse((node) => {
    if ((node as Mesh).isMesh) found.push(node as Mesh);
  });
  return found;
};

describe('the outlines of a template', () => {
  function tower() {
    const root = group('CoolingTower');
    root.add(part('Casing', 'Part'), part('Pipe', 'Steel', [3, 0, 0]));
    const fan = part('FanBlade', 'Blade', [0, 2, 0], FAN);
    fan.scale.set(3, 3, 3);
    root.add(fan);
    return buildTemplate(scene(root), createMaterialTable());
  }

  it('gives every mesh a hidden outline, so an idle model draws no more than before', () => {
    const template = tower();

    const meshes = meshesOf(template.root);
    const outlines = outlinesOf(template.root);
    expect(meshes.length).toBe(3);
    expect(outlines).toHaveLength(meshes.length);
    for (const outline of outlines) {
      expect(outline.visible).toBe(false);
      expect(meshes).toContain(outline.parent);
    }
  });

  it('starts every outline in the idle line material of the table', () => {
    const template = tower();

    for (const outline of outlinesOf(template.root)) {
      expect(outline.material).toBe(template.materials.line({ edge: 'idle', severity: null }));
    }
  });

  it('has the edges of the mesh, with the distance a dashed line needs: 0, then the length in metres', () => {
    const template = tower();
    const casing = outlinesOf(template.root).find(
      (outline) => (outline.parent as Mesh).name === '_static_Part',
    )!;

    const position = casing.geometry.getAttribute('position');
    const distance = casing.geometry.getAttribute('lineDistance');
    expect(position.count).toBe(24);
    expect(distance.count).toBe(position.count);
    for (let i = 0; i < distance.count; i += 2) {
      expect(distance.getX(i)).toBe(0);
      expect(distance.getX(i + 1)).toBeCloseTo(1, 6);
    }
  });

  it('measures a part in metres even when its node is scaled', () => {
    const template = tower();
    const fan = outlinesOf(template.root).find((outline) => outline.parent?.name === 'FanBlade')!;

    const distance = fan.geometry.getAttribute('lineDistance');
    expect(distance.getX(1)).toBeCloseTo(3, 6);
  });

  it('moves with its mesh, and a copy has its own outline over the same geometry', () => {
    const template = tower();
    const copy = instantiate(template);

    const [original] = outlinesOf(template.root);
    const [cloned] = outlinesOf(copy);
    expect(cloned).not.toBe(original);
    expect(cloned!.geometry).toBe(original!.geometry);
    expect(cloned!.material).toBe(original!.material);

    cloned!.visible = true;
    expect(original!.visible).toBe(false);
  });

  it('is freed with the template', () => {
    const template = tower();
    const spies = outlinesOf(template.root).map((outline) => vi.spyOn(outline.geometry, 'dispose'));

    template.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('remembers the table it was built with', () => {
    const table = createMaterialTable();
    const root = group('Root');
    root.add(part('Casing', 'Part'));

    expect(buildTemplate(scene(root), table).materials).toBe(table);
  });
});

// --- levels of detail (V2-19.5) --------------------------------------------------------------------------------

describe('levels of detail (V2-19.5)', () => {
  /** The LOD1 sibling as a single mesh node, 4 × 5 × 4 m like the casing, called `Root_LOD1` so that it matches `Root`. */
  const lodMesh = (material = 'Part', name = 'Root_LOD1'): Mesh => {
    const mesh = part(name, material);
    mesh.scale.set(4, 5, 4);
    return mesh;
  };

  /** A class root of a 4 × 5 × 4 m casing and a bound fan, with a LOD1 that matches it (or the one given). */
  function modelOf(lod1: Object3D | null = lodMesh()) {
    const root = group('Root');
    const casing = part('Casing', 'Part');
    casing.scale.set(4, 5, 4);
    root.add(casing, part('FanBlade', 'Blade', [0, 2, 0], FAN));
    const loaded = lod1 === null ? new Group() : scene(root, lod1);
    if (lod1 === null) loaded.add(root);
    return { template: buildTemplate(loaded, createMaterialTable()), lod1 };
  }

  const verticesOf = (mesh: Mesh): Vector3[] => {
    const position = mesh.geometry.getAttribute('position');
    return Array.from({ length: position.count }, (_, i) =>
      new Vector3().fromBufferAttribute(position, i),
    );
  };
  const meshesOf = (object: Object3D): Mesh[] => {
    const found: Mesh[] = [];
    object.traverse((node) => {
      if ((node as Mesh).isMesh === true) found.push(node as Mesh);
    });
    return found;
  };

  describe('the template', () => {
    it('merges a LOD1 that is a single mesh node into one mesh, in the class root’s frame', () => {
      const { template } = modelOf();

      const meshes = template.lod1!.children as Mesh[];
      expect(meshes.map((mesh) => mesh.name)).toEqual(['_lod1_Part']);
      const geometry = meshes[0]!.geometry;
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.toArray()).toEqual([-2, -2.5, -2]);
      expect(geometry.boundingBox!.max.toArray()).toEqual([2, 2.5, 2]);
    });

    it('merges a LOD1 made of a group, wherever it sits, relative to the class root and not the scene', () => {
      const root = group('Root', [100, 0, 0]);
      root.add(part('Casing', 'Part'));
      const lod1 = group('Root_LOD1', [100, 0, 0]);
      lod1.add(part('Body', 'Part', [0, 3, 0]));

      const template = buildTemplate(scene(root, lod1), createMaterialTable());

      const geometry = (template.lod1!.children[0] as Mesh).geometry;
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBeCloseTo(2.5, 6);
      expect(geometry.boundingBox!.max.y).toBeCloseTo(3.5, 6);
      expect(geometry.boundingBox!.min.x).toBeCloseTo(-0.5, 6);
    });

    it('makes one mesh per console material', () => {
      const lod1 = group('Root_LOD1');
      lod1.add(part('A', 'Part'), part('B', 'Steel'), part('C', 'Part'));

      const { template } = modelOf(lod1);

      expect(template.lod1!.children.map((mesh) => mesh.name).sort()).toEqual([
        '_lod1_Part',
        '_lod1_Steel',
      ]);
    });

    it('has no LOD1 for a model without a sibling, with one of another name, or with one that holds no mesh', () => {
      for (const lod1 of [null, lodMesh('Part', 'Other_LOD1'), group('Root_LOD1')]) {
        const { template } = modelOf(lod1);

        expect(template.lod1).toBeNull();
        expect(template.switchDistanceM).toBe(Infinity);
      }
    });

    it('keeps the LOD1 out of the root, which is still the statics and the bound parts', () => {
      const { template } = modelOf();

      expect(template.root.getObjectByName('_lod1')).toBeUndefined();
      expect(template.root.getObjectByName('_lod1_Part')).toBeUndefined();
      expect(staticMeshes(template.root)).toHaveLength(1);
      expect(template.root.getObjectByName('FanBlade')).toBeDefined();
    });

    it('takes the switch distance from the sphere around the LOD0 model', () => {
      const { template } = modelOf();

      expect(template.switchDistanceM).toBeCloseTo(
        lodDistance(Math.hypot(4, 5, 4) / 2, HOME_FOV_DEG),
        6,
      );
    });

    it('never switches when there is no model to measure', () => {
      const template = buildTemplate(scene(group('Root'), lodMesh()), createMaterialTable());

      expect(template.lod1).not.toBeNull();
      expect(template.switchDistanceM).toBe(Infinity);
      expect((instantiate(template) as Partial<LOD>).isLOD).toBeUndefined();
    });

    it('frees the loaded LOD1’s own geometry once it is merged', () => {
      const lod1 = lodMesh();
      const dispose = vi.spyOn(lod1.geometry, 'dispose');

      modelOf(lod1);

      expect(dispose).toHaveBeenCalled();
    });

    it('gives every LOD1 mesh a hidden outline in the idle line, like LOD0’s, so the edges read far away too', () => {
      const table = createMaterialTable();
      const root = group('Root');
      root.add(part('Casing', 'Part'));
      const template = buildTemplate(scene(root), table);

      for (const mesh of template.lod1!.children) {
        const outlines = mesh.children.filter((child) => child.name === OUTLINE_NAME);
        expect(outlines).toHaveLength(1);
        const outline = outlines[0] as LineSegments;
        expect(outline.visible).toBe(false);
        expect(outline.material).toBe(table.line({ edge: 'idle', severity: null }));
      }
    });

    it('frees the merged LOD1 geometry and its outline on dispose', () => {
      const { template } = modelOf();
      const mesh = template.lod1!.children[0] as Mesh;
      const geometry = vi.spyOn(mesh.geometry, 'dispose');
      const outline = vi.spyOn((mesh.children[0] as LineSegments).geometry, 'dispose');

      template.dispose();

      expect(geometry).toHaveBeenCalledTimes(1);
      expect(outline).toHaveBeenCalledTimes(1);
    });

    it('still builds the class when there is no LOD1, as before', () => {
      const { template } = modelOf(null);

      expect(template.lod1).toBeNull();
      expect(staticMeshes(template.root)).toHaveLength(1);
      expect(template.root.getObjectByName('FanBlade')).toBeDefined();
    });
  });

  describe('an instance', () => {
    it('is a LOD named for the class root: level 0 its copy of the root, level 1 its copy of the LOD1', () => {
      const { template } = modelOf();

      const instance = instantiate(template) as LOD;

      expect(instance.isLOD).toBe(true);
      expect(instance.name).toBe('Root');
      expect(instance.levels).toHaveLength(2);
      expect(instance.levels[0]).toMatchObject({ distance: 0 });
      expect(instance.levels[1]).toMatchObject({
        distance: template.switchDistanceM,
        hysteresis: LOD_HYSTERESIS,
      });
      expect(instance.levels[0]!.object.getObjectByName('_static_Part')).toBeDefined();
      expect(instance.levels[1]!.object.getObjectByName('_lod1_Part')).toBeDefined();
    });

    it('starts on level 0, with level 1 hidden until the renderer’s first update', () => {
      const { template } = modelOf();

      const instance = instantiate(template) as LOD;

      expect(instance.levels[0]!.object.visible).toBe(true);
      expect(instance.levels[1]!.object.visible).toBe(false);
      expect(template.lod1!.visible).toBe(true);
    });

    it('has its bound parts in level 0 only, found by name from the instance', () => {
      const { template } = modelOf();

      const instance = instantiate(template) as LOD;

      const fan = instance.getObjectByName('FanBlade');
      expect(fan).toBeDefined();
      expect(instance.levels[0]!.object.getObjectByName('FanBlade')).toBe(fan);
      expect(instance.levels[1]!.object.getObjectByName('FanBlade')).toBeUndefined();
    });

    it('shares the geometry and the materials of both levels with every copy, and has its own levels', () => {
      const { template } = modelOf();

      const one = instantiate(template) as LOD;
      const two = instantiate(template) as LOD;

      expect(one.levels[0]!.object).not.toBe(two.levels[0]!.object);
      expect(one.levels[1]!.object).not.toBe(two.levels[1]!.object);
      const [far] = meshesOf(one.levels[1]!.object);
      expect(far!.geometry).toBe(meshesOf(two.levels[1]!.object)[0]!.geometry);
      expect(far!.geometry).toBe((template.lod1!.children[0] as Mesh).geometry);
      expect(far!.material).toBe(meshesOf(two.levels[1]!.object)[0]!.material);
      const [near] = staticMeshes(one.levels[0]!.object);
      expect(near!.geometry).toBe(staticMeshes(template.root)[0]!.geometry);
    });

    it('is the plain copy of the root, with the statics as its children, when the class has no LOD1', () => {
      const { template } = modelOf(null);

      const instance = instantiate(template);

      expect((instance as Partial<LOD>).isLOD).toBeUndefined();
      expect(staticMeshes(instance)).toHaveLength(1);
    });
  });

  describe('the swap, without a renderer', () => {
    /** `lod.update(camera)` from `distance` away along z, as the renderer does when it visits the LOD. */
    function swap() {
      const { template } = modelOf();
      const lod = instantiate(template) as LOD;
      const camera = new PerspectiveCamera(HOME_FOV_DEG, 1.6, 1, 2500);
      const threshold = template.switchDistanceM;
      const at = (distance: number, from: [number, number, number] = [0, 0, 0]): number => {
        lod.position.set(...from);
        camera.position.set(from[0], from[1], from[2] + distance);
        camera.updateMatrixWorld(true);
        lod.updateMatrixWorld(true);
        lod.update(camera);
        return lod.getCurrentLevel();
      };
      return { lod, at, threshold };
    }

    it('shows LOD0 below the threshold and LOD1 from it', () => {
      const { lod, at, threshold } = swap();

      expect(at(threshold - 1)).toBe(0);
      expect(lod.levels[0]!.object.visible).toBe(true);
      expect(lod.levels[1]!.object.visible).toBe(false);

      expect(at(threshold + 1)).toBe(1);
      expect(lod.levels[0]!.object.visible).toBe(false);
      expect(lod.levels[1]!.object.visible).toBe(true);
    });

    it('holds LOD1 until the camera is a tenth nearer than the threshold, then returns to LOD0', () => {
      const { at, threshold } = swap();
      at(threshold + 1);

      expect(at(threshold * 0.95)).toBe(1);
      expect(at(threshold * 0.91)).toBe(1);
      expect(at(threshold * 0.89)).toBe(0);
    });

    it('does not hold LOD0 past the threshold: the hysteresis only keeps the level that is shown', () => {
      const { at, threshold } = swap();
      at(threshold - 1);

      expect(at(threshold * 0.95)).toBe(0);
      expect(at(threshold + 1)).toBe(1);
    });

    it('measures the distance to the instance, not to the world’s origin', () => {
      const { at, threshold } = swap();

      expect(at(threshold - 1, [500, 0, 0])).toBe(0);
      expect(at(threshold + 1, [500, 0, 0])).toBe(1);
    });
  });

  describe('culling', () => {
    const frustumOf = (camera: PerspectiveCamera): Frustum => {
      camera.updateMatrixWorld(true);
      return new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
    };

    it('gives a merged static mesh a bounding sphere that holds every vertex of what was baked in', () => {
      const root = group('Root');
      root.add(
        part('A', 'Part', [-3, 0, 0]),
        part('B', 'Part', [4, 1, 2]),
        part('C', 'Part', [0, 5, -2]),
      );
      const merged = staticMeshes(buildTemplate(scene(root), createMaterialTable()).root)[0]!;

      merged.geometry.computeBoundingSphere();

      const { center, radius } = merged.geometry.boundingSphere!;
      for (const vertex of verticesOf(merged)) {
        expect(vertex.distanceTo(center)).toBeLessThanOrEqual(radius + 1e-6);
      }
    });

    it('moves a bound part’s sphere with the part, so a turned or shifted part is culled where it is', () => {
      const { template } = modelOf();
      const fan = (instantiate(template) as LOD).getObjectByName('FanBlade') as Mesh;
      fan.geometry.computeBoundingSphere();
      const local = fan.geometry.boundingSphere!;

      fan.rotation.y = 1.2;
      fan.position.x += 30;
      fan.updateMatrixWorld(true);

      const world = local.clone().applyMatrix4(fan.matrixWorld);
      expect(world.center.x).toBeGreaterThan(29);
      for (const vertex of verticesOf(fan)) {
        expect(vertex.applyMatrix4(fan.matrixWorld).distanceTo(world.center)).toBeLessThanOrEqual(
          world.radius + 1e-6,
        );
      }
    });

    it('gives a quantised bound part a sphere that is in metres through its node’s scale', () => {
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        'position',
        new Int16BufferAttribute([-32767, 0, 0, 32767, 0, 0, 0, 32767, 0], 3, true),
      );
      const quantised = new Mesh(geometry, new MeshStandardMaterial({ name: 'Blade' }));
      quantised.name = 'Quantised';
      quantised.scale.set(5, 5, 5);
      quantised.userData = FAN;
      const root = group('Root');
      root.add(quantised);
      const template = buildTemplate(scene(root), createMaterialTable());
      const blade = template.root.getObjectByName('Quantised') as Mesh;

      blade.geometry.computeBoundingSphere();
      blade.updateMatrixWorld(true);

      const world = blade.geometry.boundingSphere!.clone().applyMatrix4(blade.matrixWorld);
      expect(world.radius).toBeGreaterThanOrEqual(5 - 1e-3);
      for (const point of [new Vector3(-5, 0, 0), new Vector3(5, 0, 0), new Vector3(0, 5, 0)]) {
        expect(point.distanceTo(world.center)).toBeLessThanOrEqual(world.radius + 1e-3);
      }
    });

    it('culls the meshes of an instance that stands off to the side and keeps those in front, copy by copy', () => {
      const { template } = modelOf(null);
      const near = instantiate(template);
      const aside = instantiate(template);
      aside.position.set(500, 0, 0);
      const camera = new PerspectiveCamera(HOME_FOV_DEG, 1.6, 1, 2500);
      camera.position.set(0, 0, 60);
      const frustum = frustumOf(camera);
      near.updateMatrixWorld(true);
      aside.updateMatrixWorld(true);

      for (const mesh of meshesOf(near)) expect(frustum.intersectsObject(mesh)).toBe(true);
      for (const mesh of meshesOf(aside)) expect(frustum.intersectsObject(mesh)).toBe(false);
    });

    it('culls everything of an instance when the camera turns away from it', () => {
      const { template } = modelOf(null);
      const instance = instantiate(template);
      const camera = new PerspectiveCamera(HOME_FOV_DEG, 1.6, 1, 2500);
      camera.position.set(0, 0, 60);
      camera.lookAt(0, 0, 200);
      const frustum = frustumOf(camera);
      instance.updateMatrixWorld(true);

      for (const mesh of meshesOf(instance)) expect(frustum.intersectsObject(mesh)).toBe(false);
    });
  });
});
