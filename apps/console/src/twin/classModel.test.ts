import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Int16BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Object3D,
  Vector3,
} from 'three';
import { twinColors } from '../styles/tokens';
import { buildTemplate, createMaterialTable, instantiate, nodeInfoOf } from './classModel';

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
function scene(root: Object3D, lod1 = part('Root_LOD1', 'Part')): Group {
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
