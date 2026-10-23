import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineSegments,
  LOD,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  boxTable,
  buildingTable,
  type PickRef,
  type PickScope,
  type PickTable,
} from '../lib/twin-core/twinPicking';
import { type BeaconTarget, DISC_CENTRE_PX } from '../lib/twin-core/twinBeaconSprites';
import { groupsForLooks, type SpanLook } from '../lib/twin-core/twinGroups';
import { applyGroups } from './applyGroups';
import { createPicker, type PickView } from './picker';

// The view: 100 × 100 px, 100 m above the origin and looking straight down, so a pixel is about 0.93 m on
// the ground plane and the screen centre is the origin. Screen up is −z.
const SIZE = 100;
const material = new MeshBasicMaterial();

function overhead(): PickView {
  const camera = new PerspectiveCamera(50, 1, 1, 1000);
  camera.position.set(0, 100, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return { camera, width: SIZE, height: SIZE };
}

const view = overhead();
const campus: PickScope = {
  kinds: new Set(['building', 'asset', 'camera']),
  assetCode: null,
  excludedBuildingId: null,
};
const isolated = (assetCode: string): PickScope => ({
  kinds: new Set(['asset', 'part']),
  assetCode,
  excludedBuildingId: null,
});
const at = (x: number, y: number) => ({ x, y });
const centre = at(SIZE / 2, SIZE / 2);

/** A box of `width × height × depth` metres standing on `y`, centred on `x`, `z`. */
function box(width: number, height: number, depth: number, x = 0, y = 0, z = 0) {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y + height / 2, z);
  return geometry;
}

const range = (zoneId: string, firstTriangle: number, triangleCount: number) => ({
  zoneId,
  firstVertex: 0,
  vertexCount: 0,
  firstTriangle,
  triangleCount,
  firstSegment: 0,
  segmentCount: 0,
});

/** A 20 × 10 × 20 m building at the origin and a 2 m box on its roof: a merged mesh each, as drawn. */
function campusScene() {
  const picker = createPicker();
  const shell = new Mesh(box(20, 10, 20), material);
  picker.addTable(shell, buildingTable([range('BLD-DC', 0, 12)]));
  const boxes = new Mesh(
    mergeGeometries([box(2, 2, 2, 0, 10, 0), box(2, 2, 2, 5, 10, 5)]),
    material,
  );
  picker.addTable(
    boxes,
    boxTable([
      {
        code: 'CT-01',
        firstVertex: 0,
        vertexCount: 24,
        firstTriangle: 0,
        triangleCount: 12,
        firstSegment: 0,
        segmentCount: 12,
      },
      {
        code: 'CT-02',
        firstVertex: 24,
        vertexCount: 24,
        firstTriangle: 12,
        triangleCount: 12,
        firstSegment: 12,
        segmentCount: 12,
      },
    ]),
  );
  return { picker, shell, boxes };
}

describe('picker with the merged meshes', () => {
  it('names the building for a ray through the building', () => {
    const { picker } = campusScene();

    expect(picker.pick(at(60, 42), view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });
  });

  it('names the asset, which is nearer, for a ray through the box on the roof', () => {
    const { picker } = campusScene();

    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('names the second box of the merged mesh by its own range', () => {
    const { picker } = campusScene();
    // The second box stands 5 m east and 5 m south; at its roof (88 m away) that is about 6 px each way.
    expect(picker.pick(at(55.4, 55.4), view, campus)).toEqual({ kind: 'asset', id: 'CT-02' });
  });

  it('names nothing through empty ground', () => {
    const { picker } = campusScene();

    expect(picker.pick(at(2, 50), view, campus)).toBeNull();
  });

  it('names the building when the assets are not in the scope', () => {
    const { picker } = campusScene();
    const buildingsOnly: PickScope = {
      kinds: new Set(['building']),
      assetCode: null,
      excludedBuildingId: null,
    };

    expect(picker.pick(centre, view, buildingsOnly)).toEqual({ kind: 'building', id: 'BLD-DC' });
  });

  it('sees through a box that is out of scope to the isolated asset behind it', () => {
    const picker = createPicker();
    // CT-02 is in front of CT-01 on the same ray, in the same merged mesh.
    const boxes = new Mesh(
      mergeGeometries([box(2, 2, 2, 0, 10, 0), box(2, 2, 2, 0, 20, 0)]),
      material,
    );
    picker.addTable(
      boxes,
      boxTable([
        {
          code: 'CT-01',
          firstVertex: 0,
          vertexCount: 24,
          firstTriangle: 0,
          triangleCount: 12,
          firstSegment: 0,
          segmentCount: 12,
        },
        {
          code: 'CT-02',
          firstVertex: 24,
          vertexCount: 24,
          firstTriangle: 12,
          triangleCount: 12,
          firstSegment: 12,
          segmentCount: 12,
        },
      ]),
    );

    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-02' });
    expect(picker.pick(centre, view, isolated('CT-01'))).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('names nothing at all when the scope allows nothing', () => {
    const { picker } = campusScene();

    expect(
      picker.pick(centre, view, { kinds: new Set(), assetCode: null, excludedBuildingId: null }),
    ).toBeNull();
  });

  it('stops naming a mesh once it is removed, and names the rest', () => {
    const picker = createPicker();
    const shell = new Mesh(box(20, 10, 20), material);
    const table: PickTable = buildingTable([range('BLD-DC', 0, 12)]);
    const remove = picker.addTable(shell, table);
    expect(picker.pick(at(60, 42), view, campus)).not.toBeNull();

    remove();

    expect(picker.pick(at(60, 42), view, campus)).toBeNull();
  });

  it('builds one bounds tree for a geometry that two meshes share', () => {
    const picker = createPicker();
    const geometry = box(2, 2, 2);
    const first = new Mesh(geometry, material);
    const second = new Mesh(geometry, material);
    const table = boxTable([
      {
        code: 'A',
        firstVertex: 0,
        vertexCount: 24,
        firstTriangle: 0,
        triangleCount: 12,
        firstSegment: 0,
        segmentCount: 12,
      },
    ]);

    picker.addTable(first, table);
    const tree = geometry.boundsTree;
    picker.addTable(second, table);

    expect(tree).toBeDefined();
    expect(geometry.boundsTree).toBe(tree);
  });

  it('forgets everything on clear', () => {
    const { picker } = campusScene();

    picker.clear();

    expect(picker.pick(centre, view, campus)).toBeNull();
  });
});

const BOX_SPANS = [
  { start: 0, count: 36 },
  { start: 36, count: 36 },
];

describe('picker with the merged meshes drawn in groups (V2-15.7, V2-15.8)', () => {
  /**
   * The campus scene with its meshes as a level draws them: a material array (as it is, faded, see-through) and the
   * groups `groupsForLooks` makes, which `Buildings` and `AssetBoxes` apply. The pick tables are the same as without
   * groups. `looks` are the two boxes' looks; the shell's is `shellLook`.
   */
  function groupedScene(looks: SpanLook[], shellLook: SpanLook = 'drawn') {
    const { picker, shell, boxes } = campusScene();
    const faded = new MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false });
    const xray = new MeshBasicMaterial({ transparent: true, opacity: 0.14, depthWrite: false });
    for (const [mesh, spans, spanLooks] of [
      [shell, [{ start: 0, count: 36 }], [shellLook]],
      [boxes, BOX_SPANS, looks],
    ] as const) {
      const target: Mesh = mesh;
      target.material = [material, faded, xray];
      const total = mesh.geometry.index?.count ?? 0;
      applyGroups(mesh.geometry, groupsForLooks(spans, spanLooks, total));
    }
    return { picker, boxes };
  }

  it.each<[string, SpanLook[]]>([
    ['nothing faded', ['drawn', 'drawn']],
    ['the first box kept', ['drawn', 'faded']],
    ['the second box kept', ['faded', 'drawn']],
    ['everything faded', ['faded', 'faded']],
  ])('names the same things as without groups: %s', (_name, looks) => {
    const { picker } = groupedScene(looks);

    expect(picker.pick(at(60, 42), view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });
    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
    expect(picker.pick(at(55.4, 55.4), view, campus)).toEqual({ kind: 'asset', id: 'CT-02' });
    expect(picker.pick(at(2, 50), view, campus)).toBeNull();
  });

  it('names the same things for a see-through shell: the walls are still triangles of the table', () => {
    const { picker } = groupedScene(['drawn', 'drawn'], 'xray');

    expect(picker.pick(at(60, 42), view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });
    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('keeps the isolated scope: the faded box is not a target, the kept one is', () => {
    const { picker } = groupedScene(['drawn', 'faded']);

    expect(picker.pick(centre, view, isolated('CT-01'))).toEqual({ kind: 'asset', id: 'CT-01' });
    expect(picker.pick(at(55.4, 55.4), view, isolated('CT-01'))).toBeNull();
  });

  it('does not hit a hidden box: the ray goes on to what is behind it', () => {
    const { picker } = groupedScene(['drawn', 'hidden']);

    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
    // Where the second box stood there is now only the roof of the building under it.
    expect(picker.pick(at(55.4, 55.4), view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });
  });

  it('hits nothing of a mesh whose every span is hidden', () => {
    const { picker } = groupedScene(['hidden', 'hidden']);

    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });
    expect(picker.pick(at(55.4, 55.4), view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });
  });

  it('is not rebuilt by a change of groups, hiding and showing included: the same bounds tree answers', () => {
    const { picker, boxes } = groupedScene(['drawn', 'drawn']);
    picker.pick(centre, view, campus);
    const tree = boxes.geometry.boundsTree;
    const total = boxes.geometry.index?.count ?? 0;

    applyGroups(boxes.geometry, groupsForLooks(BOX_SPANS, ['faded', 'drawn'], total));
    expect(boxes.geometry.boundsTree).toBe(tree);
    expect(picker.pick(at(55.4, 55.4), view, campus)).toEqual({ kind: 'asset', id: 'CT-02' });

    applyGroups(boxes.geometry, groupsForLooks(BOX_SPANS, ['hidden', 'hidden'], total));
    expect(boxes.geometry.boundsTree).toBe(tree);
    expect(picker.pick(at(55.4, 55.4), view, campus)).toEqual({ kind: 'building', id: 'BLD-DC' });

    applyGroups(boxes.geometry, groupsForLooks(BOX_SPANS, ['drawn', 'drawn'], total));
    expect(boxes.geometry.boundsTree).toBe(tree);
    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });
});

describe('picker with a building in focus (V2-15.8)', () => {
  /** The 20 × 10 × 20 m building with a 2 m box inside it, 5 m west of the middle, under the roof. */
  function insideScene() {
    const picker = createPicker();
    const shell = new Mesh(box(20, 10, 20), material);
    picker.addTable(shell, buildingTable([range('BLD-DC', 0, 12)]));
    const boxes = new Mesh(box(2, 2, 2, -5, 0, 0), material);
    picker.addTable(
      boxes,
      boxTable([
        {
          code: 'UPS-01',
          firstVertex: 0,
          vertexCount: 24,
          firstTriangle: 0,
          triangleCount: 12,
          firstSegment: 0,
          segmentCount: 12,
        },
      ]),
    );
    return picker;
  }
  /** A pixel above the box inside: the ray crosses the roof first, then the box. */
  const aboveInside = at(44.3, 50);
  const inFocus: PickScope = { ...campus, excludedBuildingId: 'BLD-DC' };

  it('is stopped by the roof of a building that is not in focus: the wall hides what is inside', () => {
    expect(insideScene().pick(aboveInside, view, campus)).toEqual({
      kind: 'building',
      id: 'BLD-DC',
    });
  });

  it('reaches the equipment inside through the see-through walls of the building in focus', () => {
    expect(insideScene().pick(aboveInside, view, inFocus)).toEqual({
      kind: 'asset',
      id: 'UPS-01',
    });
  });

  it('hits nothing where only a wall of the building in focus is under the pointer', () => {
    expect(insideScene().pick(at(60, 42), view, inFocus)).toBeNull();
  });

  it('still hits a building that is not the one in focus', () => {
    expect(
      insideScene().pick(at(60, 42), view, { ...campus, excludedBuildingId: 'BLD-OTHER' }),
    ).toEqual({
      kind: 'building',
      id: 'BLD-DC',
    });
  });
});

describe('picker with a model', () => {
  const parts = new Set(['FanBlade']);

  /** A 4 × 2 × 4 m body and, on a bound node, a fan 1 m wide above it. The outline is a hidden line. */
  function tower() {
    const root = new Group();
    root.name = 'CoolingTower';
    const body = new Mesh(box(4, 2, 4), material);
    const outline = new LineSegments(new EdgesGeometry(body.geometry), undefined);
    outline.name = '_edges';
    body.add(outline);
    const fan = new Group();
    fan.name = 'FanBlade';
    fan.add(new Mesh(box(1, 1, 1, 0, 2.5, 0), material));
    root.add(body, fan);
    root.updateMatrixWorld(true);
    return { root, outline };
  }

  const asset = (id: string): PickRef => ({ kind: 'asset', id });

  it('names a bound part while its asset is isolated', () => {
    const picker = createPicker();
    picker.addModel('CT-01', tower().root, parts);

    expect(picker.pick(centre, view, isolated('CT-01'))).toEqual({
      kind: 'part',
      id: 'FanBlade',
      assetCode: 'CT-01',
    });
  });

  it('names the asset for the same ray at campus level', () => {
    const picker = createPicker();
    picker.addModel('CT-01', tower().root, parts);

    expect(picker.pick(centre, view, campus)).toEqual(asset('CT-01'));
  });

  it('names the asset, not a part, for a ray through its static body', () => {
    const picker = createPicker();
    picker.addModel('CT-01', tower().root, parts);

    expect(picker.pick(at(52, 50), view, isolated('CT-01'))).toEqual(asset('CT-01'));
  });

  it('follows a part that has moved', () => {
    const picker = createPicker();
    const { root } = tower();
    picker.addModel('CT-01', root, parts);

    // The fan slides 1.5 m east; the ray at the centre now meets only the body.
    root.getObjectByName('FanBlade')!.position.x = 1.5;

    expect(picker.pick(centre, view, isolated('CT-01'))).toEqual(asset('CT-01'));
    expect(picker.pick(at(51.6, 50), view, isolated('CT-01'))).toEqual({
      kind: 'part',
      id: 'FanBlade',
      assetCode: 'CT-01',
    });
  });

  it('never asks the hidden outline', () => {
    const picker = createPicker();
    const { root, outline } = tower();
    const raycast = vi.spyOn(outline, 'raycast');
    picker.addModel('CT-01', root, parts);

    picker.pick(centre, view, campus);

    expect(raycast).not.toHaveBeenCalled();
  });

  it('shares one bounds tree between two instances of a class', () => {
    const picker = createPicker();
    const template = tower().root;
    const first = template.clone(true);
    const second = template.clone(true);
    second.position.x = 30;
    second.updateMatrixWorld(true);

    picker.addModel('CT-01', first, parts);
    const body = first.children[0] as Mesh;
    const tree = body.geometry.boundsTree;
    picker.addModel('CT-02', second, parts);

    expect(tree).toBeDefined();
    expect((second.children[0] as Mesh).geometry.boundsTree).toBe(tree);
  });

  it('removes a model with the function it returned', () => {
    const picker = createPicker();
    const remove = picker.addModel('CT-01', tower().root, parts);

    remove();

    expect(picker.pick(centre, view, campus)).toBeNull();
  });
});

describe('picker with the camera markers', () => {
  // The anchor of a marker at (x, 0, z) is about 1.07 px per metre from the centre, +x right, +z down.
  const marker = (id: string, x: number, z: number) => ({
    id,
    position: [x, 0, z] as [number, number, number],
  });

  it('names a camera whose target is under the pointer', () => {
    const { picker } = campusScene();
    picker.setCameras([marker('cam-1', 30, 0)]);

    // The anchor is at about (82, 50); the target stands above it.
    expect(picker.pick(at(82, 40), view, campus)).toEqual({ kind: 'camera', id: 'cam-1' });
  });

  it('puts a camera before the building behind its marker', () => {
    const { picker } = campusScene();
    picker.setCameras([marker('cam-1', 5, 0)]);

    // The anchor is at about (55.4, 50); the ray through (55, 45) meets the roof of the building.
    expect(picker.pick(at(55, 45), view, campus)).toEqual({ kind: 'camera', id: 'cam-1' });
  });

  it('puts the asset before a camera under the same pixel', () => {
    const { picker } = campusScene();
    picker.setCameras([marker('cam-1', 0, 0)]);

    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('ignores the cameras while the Cameras layer is off', () => {
    const { picker } = campusScene();
    picker.setCameras([marker('cam-1', 30, 0)]);
    const noCameras: PickScope = {
      kinds: new Set(['building', 'asset']),
      assetCode: null,
      excludedBuildingId: null,
    };

    expect(picker.pick(at(82, 40), view, noCameras)).toBeNull();
  });

  it('ignores a marker behind the camera', () => {
    const { picker } = campusScene();
    picker.setCameras([{ id: 'cam-1', position: [0, 200, 0] }]);

    expect(picker.pick(at(50, 40), view, campus)).not.toEqual({ kind: 'camera', id: 'cam-1' });
  });
});

describe('picker with the incident beacons (V2-16.4)', () => {
  const withBeacons: PickScope = { ...campus, kinds: new Set([...campus.kinds, 'beacon']) };
  // A ground point at (x, 0, z) is about 1.07 px per metre from the centre, +z down; the disc stands
  // `DISC_CENTRE_PX` above it on the screen, so a beacon at z = 26 m has its disc centre at the screen's centre.
  const target = (id: string, x: number, z: number, rank = 1, radius = 10): BeaconTarget => ({
    id,
    position: [x, 0, z],
    radius,
    rank,
  });
  const beacon = (id: string): PickRef => ({ kind: 'beacon', id });
  const discAtCentre = (id: string, rank = 1) => target(id, 0, 26, rank);

  it('names a beacon whose disc is under the pointer, and not one whose foot is', () => {
    const picker = createPicker();
    picker.setBeacons([target('inc-1', 0, 0)]);

    // The foot is the screen's centre; the disc is DISC_CENTRE_PX above it.
    expect(picker.pick(at(50, 50 - DISC_CENTRE_PX), view, withBeacons)).toEqual(beacon('inc-1'));
    expect(picker.pick(centre, view, withBeacons)).toBeNull();
  });

  it('reaches the disc’s radius plus the pad', () => {
    const picker = createPicker();
    picker.setBeacons([target('inc-1', 0, 0)]);
    const discY = 50 - DISC_CENTRE_PX;

    expect(picker.pick(at(50 + 13, discY), view, withBeacons)).toEqual(beacon('inc-1'));
    expect(picker.pick(at(50 + 15, discY), view, withBeacons)).toBeNull();
  });

  it('puts a beacon before the asset and the building behind its disc', () => {
    const { picker } = campusScene();
    picker.setBeacons([discAtCentre('inc-1')]);

    expect(picker.pick(centre, view, withBeacons)).toEqual(beacon('inc-1'));
    // Without the beacon in scope, the same pixel is the cooling tower on the roof.
    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('takes the beacon painted on top when two stand on one spot', () => {
    const picker = createPicker();
    picker.setBeacons([
      discAtCentre('low', 1),
      discAtCentre('critical', 7),
      discAtCentre('mid', 4),
    ]);

    expect(picker.pick(centre, view, withBeacons)).toEqual(beacon('critical'));
  });

  it('ignores the beacons while the scope has none', () => {
    const picker = createPicker();
    picker.setBeacons([discAtCentre('inc-1')]);

    expect(picker.pick(centre, view, campus)).toBeNull();
  });

  it('ignores a beacon behind the camera', () => {
    const picker = createPicker();
    picker.setBeacons([{ id: 'inc-1', position: [0, 200, 0], radius: 10, rank: 1 }]);

    expect(picker.pick(at(50, 50 - DISC_CENTRE_PX), view, withBeacons)).toBeNull();
  });

  it('replaces the previous beacons, and clear forgets them', () => {
    const picker = createPicker();
    picker.setBeacons([discAtCentre('old')]);
    picker.setBeacons([discAtCentre('new')]);
    expect(picker.pick(centre, view, withBeacons)).toEqual(beacon('new'));

    picker.clear();

    expect(picker.pick(centre, view, withBeacons)).toBeNull();
  });
});

describe('picker with a location being picked (V2-16.7)', () => {
  const picking: PickScope = {
    kinds: new Set(['building', 'ground']),
    assetCode: null,
    excludedBuildingId: null,
  };
  // Overhead: a pixel is about 0.93 m on the ground plane and 0.93 m on the roof's plane too (a pixel of height 90 m
  // is a little smaller), the screen centre is the origin, +x is right and screen down is +z.
  const where = (picker: ReturnType<typeof createPicker>, x: number, y: number, scope = picking) =>
    picker.pick(at(x, y), view, scope);

  it('answers the roof under a ray that crosses a building, at the roof’s height', () => {
    const { picker } = campusScene();

    const found = where(picker, 50, 50);

    expect(found).toMatchObject({ kind: 'ground' });
    expect(found).toHaveProperty('y');
    const { x, y, z } = found as Extract<PickRef, { kind: 'ground' }>;
    expect(y).toBeCloseTo(10, 5);
    expect(x).toBeCloseTo(0, 5);
    expect(z).toBeCloseTo(0, 5);
  });

  it('ignores an asset on the roof: the roof behind it is the place', () => {
    const { picker } = campusScene();

    // The cooling tower stands on the roof at the origin; the box above it is not a target while picking.
    expect(where(picker, 50, 50)).toMatchObject({ kind: 'ground' });
    expect((where(picker, 50, 50) as Extract<PickRef, { kind: 'ground' }>).y).toBeCloseTo(10, 5);
  });

  it('answers the ground plane over open land', () => {
    const { picker } = campusScene();

    const found = where(picker, 80, 50) as Extract<PickRef, { kind: 'ground' }>;

    expect(found.kind).toBe('ground');
    expect(found.y).toBeCloseTo(0, 5);
    expect(found.x).toBeGreaterThan(20);
    expect(found.z).toBeCloseTo(0, 5);
  });

  it('answers the ground plane with no mesh registered at all', () => {
    const picker = createPicker();

    const found = where(picker, 50, 50) as Extract<PickRef, { kind: 'ground' }>;

    expect(found.y).toBeCloseTo(0, 5);
    expect(found.x).toBeCloseTo(0, 5);
  });

  it('lands on the floor inside the building in focus: its roof is not a target', () => {
    const { picker } = campusScene();

    const found = where(picker, 50, 50, { ...picking, excludedBuildingId: 'BLD-DC' }) as Extract<
      PickRef,
      { kind: 'ground' }
    >;

    expect(found.y).toBeCloseTo(0, 5);
  });

  it('answers nothing for a ray that goes up and meets no shell', () => {
    const { picker } = campusScene();
    const camera = new PerspectiveCamera(50, 1, 1, 1000);
    camera.position.set(0, 100, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 200, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    expect(picker.pick(centre, { camera, width: SIZE, height: SIZE }, picking)).toBeNull();
  });

  it('changes nothing outside a pick of a location: the same scene answers things', () => {
    const { picker } = campusScene();

    expect(picker.pick(centre, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('can be asked again for another point without leaving the first one behind', () => {
    const { picker } = campusScene();

    const first = where(picker, 50, 50) as Extract<PickRef, { kind: 'ground' }>;
    const second = where(picker, 80, 50) as Extract<PickRef, { kind: 'ground' }>;

    expect(second.y).toBeCloseTo(0, 5);
    expect(first.y).toBeCloseTo(10, 5);
  });
});

describe('picker with the report’s pin (V2-16.7)', () => {
  // A tip 26 m south of the origin is about 28 px below the screen's centre.
  const tip: [number, number, number] = [0, 0, 26];

  it('is under a point on its sprite, which stands on the tip', () => {
    const picker = createPicker();
    picker.setPin(tip);

    expect(picker.pinAt(at(50, 70), view)).toBe(true);
    expect(picker.pinAt(at(50, 78), view)).toBe(true);
  });

  it('is not under a point beside, far above or well below it', () => {
    const picker = createPicker();
    picker.setPin(tip);

    expect(picker.pinAt(at(80, 70), view)).toBe(false);
    expect(picker.pinAt(at(50, 20), view)).toBe(false);
    expect(picker.pinAt(at(50, 95), view)).toBe(false);
  });

  it('is nowhere with no pin, and after the pin is taken away or the picker cleared', () => {
    const picker = createPicker();
    expect(picker.pinAt(at(50, 70), view)).toBe(false);

    picker.setPin(tip);
    picker.setPin(null);
    expect(picker.pinAt(at(50, 70), view)).toBe(false);

    picker.setPin(tip);
    picker.clear();
    expect(picker.pinAt(at(50, 70), view)).toBe(false);
  });

  it('is not under a point when it is behind the camera', () => {
    const picker = createPicker();
    picker.setPin([0, 200, 0]);

    expect(picker.pinAt(at(50, 50), view)).toBe(false);
  });

  it('is not a thing a pick finds: it is tested on its own', () => {
    const picker = createPicker();
    picker.setPin(tip);

    expect(picker.pick(at(50, 70), view, campus)).toBeNull();
  });
});

describe('picker with a model that has a LOD1 (V2-19.5)', () => {
  const parts = new Set(['FanBlade']);

  /** A LOD of a 4 × 2 × 4 m body with a bound fan, and a LOD1 silhouette 6 × 2 × 6 m (wider, to tell the levels apart). */
  function instance(withLod1 = true) {
    const near = new Group();
    near.name = 'CoolingTower';
    const fan = new Group();
    fan.name = 'FanBlade';
    fan.add(new Mesh(box(1, 1, 1, 0, 2.5, 0), material));
    near.add(new Mesh(box(4, 2, 4), material), fan);
    const lod = new LOD();
    lod.name = 'CoolingTower';
    lod.addLevel(near, 0);
    if (withLod1) {
      const far = new Group();
      far.add(new Mesh(box(6, 2, 6), material));
      lod.addLevel(far, 100);
    }
    lod.updateMatrixWorld(true);
    return { lod, near };
  }

  it('registers the meshes of both levels, so the silhouette answers a ray the body does not', () => {
    const outsideBody = at(53, 50); // about 2.8 m east of the centre: past the body (2 m), inside the silhouette (3 m)
    const without = createPicker();
    without.addModel('CT-01', instance(false).lod, parts);
    const withIt = createPicker();
    withIt.addModel('CT-01', instance().lod, parts);

    expect(without.pick(outsideBody, view, campus)).toBeNull();
    expect(withIt.pick(outsideBody, view, campus)).toEqual({ kind: 'asset', id: 'CT-01' });
  });

  it('still answers a ray on level 0 while it is not the level drawn: three’s raycast ignores `visible`, which changes nothing where a part can be picked', () => {
    const { lod, near } = instance();
    near.visible = false;
    const picker = createPicker();
    picker.addModel('CT-01', lod, parts);

    expect(picker.pick(centre, view, isolated('CT-01'))).toEqual({
      kind: 'part',
      id: 'FanBlade',
      assetCode: 'CT-01',
    });
  });
});
