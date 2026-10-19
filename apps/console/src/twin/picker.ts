import {
  type Camera,
  type Intersection,
  Matrix4,
  type Mesh,
  type Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import type { MarkerPlacement } from '../lib/twinMarkers';
import {
  cameraHits,
  choose,
  entryAt,
  type PickHit,
  type PickRef,
  type PickScope,
  type PickTable,
  type ProjectedMarker,
  type ScreenPoint,
} from '../lib/twinPicking';

/*
 * The three.js side of picking (V2-15.3, ADR-0020 § Scene, "Settled in V2-15.3"): it keeps the meshes that are
 * drawn, each with the way to turn a hit on it into a `PickRef`, and casts one ray at them. There is no proxy
 * geometry: the shells and the boxes are the merged meshes with their `ranges` tables, the models are the
 * instances' own merged static meshes and bound parts, so what is hit is exactly what is seen. A geometry gets
 * a `three-mesh-bvh` bounds tree the first time a mesh using it is registered, and only once, because the
 * instances of a class share their geometry.
 *
 * No React and no WebGL: `PickLayer` (the canvas) drives it, and it tests with real `three` objects. The
 * rules of which hit wins are `lib/twinPicking.ts`'s.
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

  // Reused by every pick: a pick allocates only its hit arrays.
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const anchor = new Vector3();
  const toView = new Matrix4();

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

  /** The camera markers under the pointer, projected with the same camera the ray uses. */
  const projectCameras = (view: PickView): ProjectedMarker[] => {
    toView.copy(view.camera.matrixWorld).invert();
    const projected: ProjectedMarker[] = [];
    for (const { id, position } of cameras) {
      anchor.set(position[0], position[1], position[2]).applyMatrix4(toView);
      // In front of the camera only: a point behind it would project, mirrored, onto the screen.
      if (anchor.z >= 0) continue;
      anchor.applyMatrix4(view.camera.projectionMatrix);
      projected.push({
        id,
        x: (anchor.x * 0.5 + 0.5) * view.width,
        y: (-anchor.y * 0.5 + 0.5) * view.height,
      });
    }
    return projected;
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

    pick(point, view, scope) {
      if (scope.kinds.size === 0 || view.width <= 0 || view.height <= 0) return null;
      view.camera.updateMatrixWorld();
      const hits: PickHit[] = [];

      if (registrations.size > 0) {
        if (listStale) {
          list = [...owners.keys()];
          listStale = false;
        }
        // The bound parts have moved since the last render, which is what updates their world matrices.
        for (const { root } of registrations) root.updateWorldMatrix(true, true);
        ndc.set((point.x / view.width) * 2 - 1, -(point.y / view.height) * 2 + 1);
        raycaster.setFromCamera(ndc, view.camera);
        // Not `firstHitOnly`: a merged mesh holds many things, and the nearest one may be out of scope
        // (a faded box in front of the isolated asset), so every crossing is named and `choose` filters.
        for (const intersection of raycaster.intersectObjects(list, false)) {
          const ref = owners.get(intersection.object as Mesh)?.refOf(intersection);
          if (ref !== undefined) hits.push({ ref, distance: intersection.distance });
        }
      }

      if (scope.kinds.has('camera') && cameras.length > 0) {
        hits.push(...cameraHits(point, projectCameras(view)));
      }
      return choose(hits, scope);
    },

    clear() {
      registrations.clear();
      owners.clear();
      list = [];
      listStale = false;
      cameras = [];
    },
  };
}
