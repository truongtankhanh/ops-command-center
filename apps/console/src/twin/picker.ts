import {
  type Camera,
  type Intersection,
  Matrix4,
  type Mesh,
  type Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { type BeaconTarget, DISC_CENTRE_PX } from '../lib/twin-core/twinBeaconSprites';
import type { Vec3 } from '../lib/twin-core/twinCamera';
import type { MarkerPlacement } from '../lib/twin-core/twinMarkers';
import { pinHits } from '../lib/twin-core/twinPin';
import {
  beaconHits,
  cameraHits,
  choose,
  entryAt,
  nearestSurface,
  type PickHit,
  type PickRef,
  type PickScope,
  type PickTable,
  type ProjectedBeacon,
  type ProjectedMarker,
  type ScreenPoint,
  type SurfaceHit,
} from '../lib/twin-core/twinPicking';

/*
 * The three.js side of picking (V2-15.3, ADR-0020 § Scene, "Settled in V2-15.3"): it keeps the meshes that are
 * drawn, each with the way to turn a hit on it into a `PickRef`, and casts one ray at them. There is no proxy
 * geometry: the shells and the boxes are the merged meshes with their `ranges` tables, the models are the
 * instances' own merged static meshes and bound parts, so what is hit is exactly what is seen. A geometry gets
 * a `three-mesh-bvh` bounds tree the first time a mesh using it is registered, and only once, because the
 * instances of a class share their geometry.
 *
 * The camera markers and the incident beacons (V2-16.4) are sprites, so they are not meshes in the list: each is
 * projected with the camera of the pick and tested in screen space (`lib/twin-core/twinPicking.ts`). The beacons it is given
 * are the ones that are drawn (`Beacons` registers them), a beacon's target is its disc, which stands
 * `DISC_CENTRE_PX` above its ground point on the screen.
 *
 * While the report's location is picked (V2-16.7) the same ray answers a different question, not "what is under the
 * pointer" but "where": the nearest of the building shells (roofs and walls) and the ground plane `y = 0`, an
 * analytic intersection since the ground is drawn but is not a mesh the ray meets. The answer is a `ground` ref with
 * the point in scene metres (`nearestSurface`); assets and parts are ignored, so a pin goes behind an asset on a roof.
 * The report's pin is a sprite too: it is tested in screen space (`pinAt`), at once, because a press on it must decide
 * before the camera's controls hear it whether it starts a drag.
 *
 * No React and no WebGL: `PickLayer` (the canvas) drives it, and it tests with real `three` objects. The
 * rules of which hit wins are `lib/twin-core/twinPicking.ts`'s.
 */

/** What a pick needs to know of the view: the camera and the canvas's size in CSS pixels. */
export interface PickView {
  camera: Camera;
  width: number;
  height: number;
}

export interface Picker {
  /** A merged mesh whose triangles `table` names (the shells, the boxes). Returns what removes it. */
  addTable(mesh: Mesh, table: PickTable): () => void;
  /**
   * One asset's model instance: any mesh under `object` is the asset, except one under a node named in
   * `partNames` (the nodes a binding moves or tints), which is that part. Returns what removes it.
   */
  addModel(assetCode: string, object: Object3D, partNames: ReadonlySet<string>): () => void;
  /** The camera markers to test in screen space, replacing the previous ones. */
  setCameras(markers: readonly Pick<MarkerPlacement, 'id' | 'position'>[]): void;
  /** The beacons to test in screen space, replacing the previous ones (V2-16.4). */
  setBeacons(beacons: readonly BeaconTarget[]): void;
  /**
   * The report's pin, by its tip in scene metres, or `null` for none (the pin is a target only while a location is
   * picked, V2-16.7).
   */
  setPin(tip: Vec3 | null): void;
  /** Whether the pin is under `point` on the screen right now, projected with `view`'s camera. */
  pinAt(point: ScreenPoint, view: PickView): boolean;
  /** The winner under `point` (CSS pixels from the canvas's top-left corner), or `null`. */
  pick(point: ScreenPoint, view: PickView, scope: PickScope): PickRef | null;
  /** Forgets everything. */
  clear(): void;
}

/** One registered thing: what to bring up to date before a ray, and how to name a hit on its meshes. */
interface Registration {
  root: Object3D;
  meshes: readonly Mesh[];
  refOf(hit: Intersection): PickRef | undefined;
}

/** The ground plane `y = 0`, facing up: where a location picked in open land is (V2-16.7). */
const GROUND = new Plane(new Vector3(0, 1, 0), 0);

const isMesh = (node: Object3D): node is Mesh => (node as Mesh).isMesh === true;

/** Gives `mesh` the accelerated raycast and its geometry a bounds tree, once however many meshes share it. */
function accelerate(mesh: Mesh): void {
  mesh.raycast = acceleratedRaycast;
  mesh.geometry.boundsTree ??= new MeshBVH(mesh.geometry);
}

export function createPicker(): Picker {
  const registrations = new Set<Registration>();
  const owners = new Map<Mesh, Registration>();
  let list: Mesh[] = [];
  let listStale = false;
  let cameras: readonly Pick<MarkerPlacement, 'id' | 'position'>[] = [];
  let beacons: readonly BeaconTarget[] = [];
  let pin: Vec3 | null = null;

  // Reused by every pick: a pick allocates only its hit arrays.
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const anchor = new Vector3();
  const toView = new Matrix4();
  const onGround = new Vector3();

  const add = (registration: Registration): (() => void) => {
    registrations.add(registration);
    for (const mesh of registration.meshes) {
      accelerate(mesh);
      owners.set(mesh, registration);
    }
    listStale = true;
    return () => {
      if (!registrations.delete(registration)) return;
      for (const mesh of registration.meshes) owners.delete(mesh);
      listStale = true;
    };
  };

  /**
   * Where each ground point is on the screen, in CSS pixels from the canvas's top-left corner, projected with the
   * same camera the ray uses. A point behind the camera is dropped: it would project, mirrored, onto the screen.
   */
  const project = <T extends { position: readonly [number, number, number] }>(
    items: readonly T[],
    view: PickView,
  ): { item: T; x: number; y: number }[] => {
    toView.copy(view.camera.matrixWorld).invert();
    const projected: { item: T; x: number; y: number }[] = [];
    for (const item of items) {
      const [x, y, z] = item.position;
      anchor.set(x, y, z).applyMatrix4(toView);
      if (anchor.z >= 0) continue;
      anchor.applyMatrix4(view.camera.projectionMatrix);
      projected.push({
        item,
        x: (anchor.x * 0.5 + 0.5) * view.width,
        y: (-anchor.y * 0.5 + 0.5) * view.height,
      });
    }
    return projected;
  };

  const projectCameras = (view: PickView): ProjectedMarker[] =>
    project(cameras, view).map(({ item, x, y }) => ({ id: item.id, x, y }));

  /** The disc of each beacon: its ground point lifted by the stem, which is a fixed number of screen pixels. */
  const projectBeacons = (view: PickView): ProjectedBeacon[] =>
    project(beacons, view).map(({ item, x, y }) => ({
      id: item.id,
      x,
      y: y - DISC_CENTRE_PX,
      radius: item.radius,
      rank: item.rank,
    }));

  /**
   * Points the shared raycaster through `point` and returns every crossing of the registered meshes, nearest first.
   * Not `firstHitOnly`: a merged mesh holds many things, and the nearest one may be out of scope (a faded box in
   * front of the isolated asset), so every crossing is named and the caller filters.
   */
  const castRay = (point: ScreenPoint, view: PickView): Intersection[] => {
    ndc.set((point.x / view.width) * 2 - 1, -(point.y / view.height) * 2 + 1);
    raycaster.setFromCamera(ndc, view.camera);
    if (registrations.size === 0) return [];
    if (listStale) {
      list = [...owners.keys()];
      listStale = false;
    }
    // The bound parts have moved since the last render, which is what updates their world matrices.
    for (const { root } of registrations) root.updateWorldMatrix(true, true);
    return raycaster.intersectObjects(list, false);
  };

  /** Where a location picked at `point` would be: the nearest of the shells and the ground, as a `ground` ref. */
  const locate = (point: ScreenPoint, view: PickView, scope: PickScope): PickRef | null => {
    const hits: SurfaceHit[] = [];
    for (const intersection of castRay(point, view)) {
      const ref = owners.get(intersection.object as Mesh)?.refOf(intersection);
      if (ref?.kind !== 'building') continue;
      const { x, y, z } = intersection.point;
      hits.push({ distance: intersection.distance, point: [x, y, z], buildingId: ref.id });
    }
    // The plane, for a ray that goes down (one that goes up or along it meets nothing here).
    if (raycaster.ray.intersectPlane(GROUND, onGround) !== null) {
      hits.push({
        distance: raycaster.ray.origin.distanceTo(onGround),
        point: [onGround.x, onGround.y, onGround.z],
        buildingId: null,
      });
    }
    const found = nearestSurface(hits, scope);
    return found === null ? null : { kind: 'ground', x: found[0], y: found[1], z: found[2] };
  };

  return {
    addTable(mesh, table) {
      return add({
        root: mesh,
        meshes: [mesh],
        refOf: (hit) => (hit.faceIndex == null ? undefined : entryAt(table, hit.faceIndex)),
      });
    },

    addModel(assetCode, object, partNames) {
      // Meshes only: the hidden `_edges` outlines are lines and never answer a ray.
      const meshes: Mesh[] = [];
      object.traverse((node) => {
        if (isMesh(node)) meshes.push(node);
      });
      return add({
        root: object,
        meshes,
        refOf: (hit) => {
          for (let node: Object3D | null = hit.object; node !== null; node = node.parent) {
            if (partNames.has(node.name)) return { kind: 'part', id: node.name, assetCode };
            if (node === object) break;
          }
          return { kind: 'asset', id: assetCode };
        },
      });
    },

    setCameras(markers) {
      cameras = markers;
    },

    setBeacons(targets) {
      beacons = targets;
    },

    setPin(tip) {
      pin = tip;
    },

    pinAt(point, view) {
      if (pin === null || view.width <= 0 || view.height <= 0) return false;
      view.camera.updateMatrixWorld();
      const [tip] = project([{ position: pin }], view);
      return pinHits(point, tip === undefined ? null : { x: tip.x, y: tip.y });
    },

    pick(point, view, scope) {
      if (scope.kinds.size === 0 || view.width <= 0 || view.height <= 0) return null;
      view.camera.updateMatrixWorld();
      if (scope.kinds.has('ground')) return locate(point, view, scope);
      const hits: PickHit[] = [];

      for (const intersection of castRay(point, view)) {
        const ref = owners.get(intersection.object as Mesh)?.refOf(intersection);
        if (ref !== undefined) hits.push({ ref, distance: intersection.distance });
      }

      if (scope.kinds.has('camera') && cameras.length > 0) {
        hits.push(...cameraHits(point, projectCameras(view)));
      }
      if (scope.kinds.has('beacon') && beacons.length > 0) {
        hits.push(...beaconHits(point, projectBeacons(view)));
      }
      return choose(hits, scope);
    },

    clear() {
      registrations.clear();
      owners.clear();
      list = [];
      listStale = false;
      cameras = [];
      beacons = [];
      pin = null;
    },
  };
}
