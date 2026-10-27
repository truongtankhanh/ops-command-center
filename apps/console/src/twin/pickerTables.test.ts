import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { buildBoxGeometry } from '../lib/twin-core/twinBoxes';
import { buildShellGeometry } from '../lib/twin-core/twinBuildings';
import { groupsForLooks, type SpanLook } from '../lib/twin-core/twinGroups';
import { boxTable, buildingTable, type PickScope } from '../lib/twin-core/twinPicking';
import type { PlacedAsset } from '../lib/twin-core/twinPlacement';
import { applyGroups } from './applyGroups';
import { createPicker, type PickView } from './picker';

/*
 * The pick tables of a campus-sized mesh (3d-click-wrong-building). `picker.test.ts` registers one building and two
 * boxes, which is below the size where the bug shows: `three-mesh-bvh`'s default build sorts the triangles inside the
 * geometry's index, and a hit's `faceIndex` then no longer matches the ranges the tables (and the draw groups) were
 * written over. From four buildings up, a click named another building: with the demo's twelve, in the order the API
 * returns them, the Admin Building came out as the Innovation Hub. These cases use the real builders
 * (`buildShellGeometry`, `buildBoxGeometry`) at the size of the demo.
 */

const material = new MeshBasicMaterial();
const faded = new MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false });
const xray = new MeshBasicMaterial({ transparent: true, opacity: 0.14, depthWrite: false });

/**
 * The demo campus's twelve `building` zones: name, code, east and north of the campus centre, width, depth and height,
 * in metres. A copy of `apps/api/src/database/seed/campus.ts` (`ZONES`): the console may not import the API's seed, so
 * if the seed's buildings change this list is the one to update. Seed order.
 */
const DEMO_BUILDINGS = [
  ['Innovation Hub', 'BLD-HUB', -120, 60, 90, 60, 24],
  ['Library', 'BLD-LIB', 40, 120, 70, 50, 18],
  ['Data Center', 'BLD-DC', 175, 40, 60, 46, 14],
  ['Lecture Hall A', 'BLD-LHA', -60, -110, 80, 40, 16],
  ['Student Center', 'BLD-STU', 110, -95, 72, 50, 12],
  ['Science Lab', 'BLD-LAB', 170, 212, 90, 64, 16],
  ['Dormitory A', 'BLD-DORA', 80, -181.5, 90, 47, 20],
  ['Dormitory B', 'BLD-DORB', 178.5, -181.5, 87, 47, 20],
  ['Health Clinic', 'BLD-CLINIC', 183.5, -240, 77, 56, 10],
  ['Sports Hall', 'BLD-SPORTS', -40, 207, 80, 74, 14],
  ['Admin Building', 'BLD-ADMIN', -226, -14, 92, 68, 14],
  ['Security office', 'BLD-SEC', 42, -251.5, 32, 27, 6],
] as const;

type DemoBuilding = (typeof DEMO_BUILDINGS)[number];

/** The zone orders a scene can get: the API's `name ASC` (`zones.service.ts`), the seed's, and its reverse. */
const ORDERS: [string, readonly DemoBuilding[]][] = [
  ['the API order (name ASC)', [...DEMO_BUILDINGS].sort((a, b) => a[0].localeCompare(b[0]))],
  ['the seed order', DEMO_BUILDINGS],
  ['reversed', [...DEMO_BUILDINGS].reverse()],
];

const [, apiOrder] = ORDERS[0]!;

const buildingsOnly: PickScope = {
  kinds: new Set(['building']),
  assetCode: null,
  excludedBuildingId: null,
};
const assetsOnly: PickScope = {
  kinds: new Set(['asset']),
  assetCode: null,
  excludedBuildingId: null,
};

/** A camera `height` metres above the origin looking straight down, screen up = −z (north), on a square canvas. */
function overhead(height: number, size: number): PickView {
  const camera = new PerspectiveCamera(50, 1, 1, 5000);
  camera.position.set(0, height, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return { camera, width: size, height: size };
}

/** Where a scene point is on the canvas, in CSS pixels from its top-left corner. */
function screenOf(view: PickView, x: number, y: number, z: number) {
  const ndc = new Vector3(x, y, z).project(view.camera);
  return { x: (ndc.x * 0.5 + 0.5) * view.width, y: (-ndc.y * 0.5 + 0.5) * view.height };
}

/** The whole campus fits in this view (the farthest roof edge is about 275 m from the centre). */
const campusView = overhead(800, 800);

/** The shells of `order` as `Buildings.tsx` draws them: one merged mesh, one group over everything, three materials. */
function shellScene(order: readonly DemoBuilding[], register = true) {
  const shells = order.map(([, zoneId, east, north, width, depth, heightM]) => ({
    zoneId,
    heightM,
    // Scene metres: x east, z = −north.
    ring: [
      [east - width / 2, -north + depth / 2],
      [east + width / 2, -north + depth / 2],
      [east + width / 2, -north - depth / 2],
      [east - width / 2, -north - depth / 2],
    ] as [number, number][],
  }));
  const { positions, normals, indices, ranges } = buildShellGeometry(shells);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const spans = ranges.map((r) => ({ start: r.firstTriangle * 3, count: r.triangleCount * 3 }));
  const total = indices.length;
  applyGroups(geometry, groupsForLooks(spans, [], total));
  const mesh = new Mesh(geometry, [material, faded, xray]);
  const indexBefore = Array.from(geometry.index!.array);
  const picker = createPicker();
  if (register) picker.addTable(mesh, buildingTable(ranges));
  const roof = (code: string) => {
    const building = order.find((candidate) => candidate[1] === code)!;
    const [, , east, north, width, depth, heightM] = building;
    return { east, north, width, depth, heightM };
  };
  /** The screen point of a spot on a roof; `u`, `v` in −0.5…0.5 across its width and depth. */
  const onRoof = (code: string, u = 0, v = 0) => {
    const { east, north, width, depth, heightM } = roof(code);
    return screenOf(campusView, east + u * width, heightM, -north + v * depth);
  };
  /** Applies the looks of a building in focus (it see-through, the rest faded), or hides `hidden`. */
  const look = (looks: (code: string) => SpanLook) =>
    applyGroups(
      geometry,
      groupsForLooks(
        spans,
        ranges.map((r) => looks(r.zoneId)),
        total,
      ),
    );
  return { picker, mesh, geometry, ranges, indexBefore, onRoof, look };
}

describe('picker with the demo campus: the twelve building shells', () => {
  it.each(ORDERS)(
    'names each building under the middle of its roof, zones in %s',
    (_name, order) => {
      const { picker, onRoof } = shellScene(order);

      for (const [, code] of order) {
        expect(picker.pick(onRoof(code), campusView, buildingsOnly), code).toEqual({
          kind: 'building',
          id: code,
        });
      }
    },
  );

  // The report: a click on the Admin Building flew the camera to the Innovation Hub.
  it('names the Admin Building for a click on it, not the Innovation Hub', () => {
    const { picker, onRoof } = shellScene(apiOrder);

    expect(picker.pick(onRoof('BLD-ADMIN'), campusView, buildingsOnly)).toEqual({
      kind: 'building',
      id: 'BLD-ADMIN',
    });
    expect(picker.pick(onRoof('BLD-HUB'), campusView, buildingsOnly)).toEqual({
      kind: 'building',
      id: 'BLD-HUB',
    });
  });

  it('names a grid of points inside each roof as that building', () => {
    const { picker, onRoof } = shellScene(apiOrder);
    const steps = [-0.4, -0.2, 0, 0.2, 0.4];

    for (const [, code] of apiOrder) {
      for (const u of steps) {
        for (const v of steps) {
          expect(
            picker.pick(onRoof(code, u, v), campusView, buildingsOnly),
            `${code} ${u} ${v}`,
          ).toEqual({
            kind: 'building',
            id: code,
          });
        }
      }
    }
  });

  it('leaves the index as the builders wrote it, so the tables and the draw groups stay valid', () => {
    const { geometry, indexBefore } = shellScene(apiOrder);

    expect(Array.from(geometry.index!.array)).toEqual(indexBefore);
  });

  // Groups change after the tree is built (a focus, a fade, a hidden building); the table does not move.
  it('still names every building after a focus, and not a hidden one', () => {
    const { picker, onRoof, look } = shellScene(apiOrder);
    const named = (code: string) => picker.pick(onRoof(code), campusView, buildingsOnly);

    look((code) => (code === 'BLD-HUB' ? 'xray' : 'faded'));
    for (const [, code] of apiOrder)
      expect(named(code), code).toEqual({ kind: 'building', id: code });

    look((code) => (code === 'BLD-ADMIN' ? 'hidden' : 'faded'));
    expect(named('BLD-ADMIN')).toBeNull();
    for (const [, code] of apiOrder) {
      if (code !== 'BLD-ADMIN') expect(named(code), code).toEqual({ kind: 'building', id: code });
    }

    look(() => 'drawn');
    for (const [, code] of apiOrder)
      expect(named(code), code).toEqual({ kind: 'building', id: code });
  });
});

describe('picker with a campus-sized set of equipment boxes', () => {
  const COLUMNS = 6;
  const ROWS = 4;
  /** 24 boxes of different sizes on a grid, 14 m apart, a few turned. */
  const placed = Array.from({ length: COLUMNS * ROWS }, (_, index): PlacedAsset => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    return {
      code: `BX-${String(index + 1).padStart(2, '0')}`,
      classCode: 'box',
      zoneId: 'z1',
      placement: 'outdoor',
      pose: {
        x: (column - (COLUMNS - 1) / 2) * 14,
        y: 0,
        z: (row - (ROWS - 1) / 2) * 14,
        rotationY: (index % 3) * 0.4,
      },
      size: { x: 3 + (index % 4), y: 2 + (index % 5), z: 3 + (index % 3) },
    };
  });
  const view = overhead(250, 500);

  function boxScene() {
    const { positions, normals, indices, ranges } = buildBoxGeometry(placed);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    const spans = ranges.map((r) => ({ start: r.firstTriangle * 3, count: r.triangleCount * 3 }));
    applyGroups(geometry, groupsForLooks(spans, [], indices.length));
    const mesh = new Mesh(geometry, [material, faded]);
    const indexBefore = Array.from(geometry.index!.array);
    const picker = createPicker();
    picker.addTable(mesh, boxTable(ranges));
    return { picker, geometry, indexBefore };
  }

  it('names each box under the middle of its top', () => {
    const { picker } = boxScene();

    for (const { code, pose, size } of placed) {
      const at = screenOf(view, pose.x, pose.y + size.y, pose.z);
      expect(picker.pick(at, view, assetsOnly), code).toEqual({ kind: 'asset', id: code });
    }
  });

  it('leaves the index as the builders wrote it', () => {
    const { geometry, indexBefore } = boxScene();

    expect(Array.from(geometry.index!.array)).toEqual(indexBefore);
  });
});

// The library behaviour the tables rest on. If an upgrade changes it, this fails here and not at a user's click.
describe('three-mesh-bvh in indirect mode', () => {
  it('leaves the index alone and reports a hit as the triangle’s original position', () => {
    // Not registered with a picker: the library on its own, with the tree built the way `picker.ts` builds it.
    const { mesh, geometry, ranges, indexBefore } = shellScene(apiOrder, false);
    mesh.raycast = acceleratedRaycast;
    geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
    mesh.updateMatrixWorld(true);

    expect(Array.from(geometry.index!.array)).toEqual(indexBefore);

    const raycaster = new Raycaster();
    for (const range of ranges) {
      const [, , east, north, , , heightM] = apiOrder.find(
        (candidate) => candidate[1] === range.zoneId,
      )!;
      raycaster.set(new Vector3(east, heightM + 100, -north), new Vector3(0, -1, 0));
      const hit = raycaster.intersectObject(mesh, false)[0]!;
      expect(hit.faceIndex, range.zoneId).toBeGreaterThanOrEqual(range.firstTriangle);
      expect(hit.faceIndex, range.zoneId).toBeLessThan(range.firstTriangle + range.triangleCount);
    }
  });
});
