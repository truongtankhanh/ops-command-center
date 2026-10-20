import {
  Box3,
  type BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  type InterleavedBufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  LOD,
  type Material,
  type Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  Sphere,
  Texture,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NodeInfo } from '../lib/twinBindings';
import { HOME_FOV_DEG, LOD_HYSTERESIS, lodDistance } from '../lib/twinCamera';
import {
  type AssetLook,
  EDGE_DASH_M,
  EDGE_GAP_M,
  edgeColour,
  faceColour,
  GHOST_OPACITY,
  type MaterialName,
  materialSpec,
} from '../lib/twinMaterials';

/*
 * A loaded class model made ready for the scene (V2-14.7, ADR-0020 § Model contract): the vendor's
 * materials replaced by the console's, the static parts merged once, the bound parts kept as separate
 * objects, and a cheap `clone` for every asset of the class. It needs `three`'s scene graph but not WebGL
 * (nothing here touches a renderer), so it is tested with hand-built scenes.
 *
 * What a model looks like when it arrives: glTF's loader returns a `scene` holding the class root
 * (`CoolingTower`) and its `_LOD1` sibling; node `extras` arrive on `userData`; a node with a `bind` in
 * them is a **bound part**, which V2-14.8 will move; every other node is **static**.
 */

/**
 * The console's materials by name, shared by every model that is built with the table, and the materials
 * those take under a look (V2-14.9). A look is a *pool*: one material per (name, face, severity), never one
 * per instance, so an alarmed tower and an alarmed generator share the alarmed `Steel`.
 */
export interface MaterialTable {
  /** The console material for a glTF material's name (`Part` for an unknown one). */
  get(name: string | undefined): MeshLambertMaterial;
  /**
   * The same material under a look: its colour for the face (`faceColour`), the same opacity. `idle` is `get`. A
   * `ghost` look (V2-15.7, another asset is isolated) is faint and does not write depth, whatever the face: one more
   * pooled material per name and face, never a copy per instance.
   */
  look(
    name: string | undefined,
    look: Pick<AssetLook, 'face' | 'severity'> & { ghost?: boolean },
  ): MeshLambertMaterial;
  /** An outline under a look: a solid line, dashed for `stale-dashed`, in the colour of the edge (`edgeColour`). */
  line(look: Pick<AssetLook, 'edge' | 'severity'>): LineBasicMaterial;
  dispose(): void;
}

/**
 * One `MeshLambertMaterial` per console material, made the first time it is asked for: the colour is the
 * material's top tone, and the scene's two lights give the faces their other tones, as for the shells and
 * the boxes. `Xray` is see-through and does not write depth, so what stands behind the generator's
 * enclosure shows through it. Every face material is pushed back a little (`polygonOffset`), as the shells
 * are, so an outline on its edge wins instead of z-fighting with it.
 */
export function createMaterialTable(): MaterialTable {
  const made = new Map<string, MeshLambertMaterial>();
  const lines = new Map<string, LineBasicMaterial>();

  const faceMaterial = (
    name: MaterialName,
    color: string,
    opacity: number,
  ): MeshLambertMaterial => {
    const material = new MeshLambertMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    material.name = name;
    return material;
  };

  const table: MaterialTable = {
    get(name) {
      const { name: resolved, color, opacity } = materialSpec(name);
      let material = made.get(resolved);
      if (material === undefined) {
        material = faceMaterial(resolved, color, opacity);
        made.set(resolved, material);
      }
      return material;
    },
    look(name, look) {
      const ghost = look.ghost === true;
      if (look.face === 'idle' && !ghost) return table.get(name);
      const { name: resolved, color, opacity } = materialSpec(name);
      // Only an alarmed face depends on the severity.
      const key = `${resolved}|${look.face}|${look.face === 'alarm' ? look.severity : ''}${ghost ? '|ghost' : ''}`;
      let material = made.get(key);
      if (material === undefined) {
        // A see-through material (`Xray`) is already fainter than the ghost: faded never makes it more solid.
        material = faceMaterial(
          resolved,
          faceColour(color, look),
          ghost ? Math.min(opacity, GHOST_OPACITY) : opacity,
        );
        made.set(key, material);
      }
      return material;
    },
    line(look) {
      const key = `${look.edge}|${look.edge === 'severity' ? look.severity : ''}`;
      let material = lines.get(key);
      if (material === undefined) {
        const color = edgeColour(look);
        material =
          look.edge === 'stale-dashed'
            ? new LineDashedMaterial({ color, dashSize: EDGE_DASH_M, gapSize: EDGE_GAP_M })
            : new LineBasicMaterial({ color });
        lines.set(key, material);
      }
      return material;
    },
    dispose() {
      for (const material of made.values()) material.dispose();
      for (const material of lines.values()) material.dispose();
      made.clear();
      lines.clear();
    },
  };
  return table;
}

/** A model ready to be placed once per asset. */
export interface ClassTemplate {
  /** The class root: the merged static parts and the bound parts, at the model's own origin. It is level 0 (LOD0). */
  root: Group;
  /**
   * The lower level of detail (V2-19.5): the model's `<Root>_LOD1` sibling with its meshes merged, one per console
   * material, in the class root's frame, each with a hidden outline. A static silhouette: it has no bound parts. `null`
   * when the model has no LOD1 (the checker allows that) or it cannot be merged: the class is then LOD0 only.
   */
  lod1: Group | null;
  /** The camera distance, in metres, from which `lod1` is drawn (`lodDistance`); `Infinity` when there is none. */
  switchDistanceM: number;
  /**
   * The model's nodes as plain data, as they were **before** the static parts were merged: what
   * `bindingsFromNodes` reads (the hierarchy and the `extras`), so the bindings can be built once the
   * class's points are known.
   */
  info: NodeInfo;
  /** The table the template was built with: where an instance finds the pooled materials of a look. */
  materials: MaterialTable;
  /** Frees the geometry, the outlines' included. The materials belong to the table. */
  dispose(): void;
}

/** A node as `bindingsFromNodes` reads it: its name, its `extras` (glTF's land on `userData`) and its children. */
export function nodeInfoOf(object: Object3D): NodeInfo {
  return {
    name: object.name,
    extras: object.userData,
    children: object.children.map(nodeInfoOf),
  };
}

const isBound = (object: Object3D): boolean =>
  (object.userData as { bind?: unknown } | undefined)?.bind !== undefined;

const isMesh = (object: Object3D): object is Mesh => (object as Mesh).isMesh === true;

const isLines = (object: Object3D): object is LineSegments =>
  (object as LineSegments).isLineSegments === true;

/**
 * The name of the hidden outline every mesh of a template carries (V2-14.9). An outline is drawn only when a
 * look needs one (a stale dash, a severity, the accent): an idle model has none, so it costs no draw call.
 */
export const OUTLINE_NAME = '_edges';

/** Faces that meet at more than this angle make an outline edge; the diagonal of a flat quad is not one. */
export const OUTLINE_THRESHOLD_DEG = 30;

/** An attribute as plain floats: `getX` undoes a quantised file's normalisation, which a matrix cannot be applied through. */
function floats(attribute: BufferAttribute | InterleavedBufferAttribute): Float32BufferAttribute {
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i += 1) {
    out[3 * i] = attribute.getX(i);
    out[3 * i + 1] = attribute.getY(i);
    out[3 * i + 2] = attribute.getZ(i);
  }
  return new Float32BufferAttribute(out, 3);
}

/**
 * The geometry as the merge needs it: positions and normals as floats, indexed, nothing else. Meshopt files
 * are usually quantised (16-bit normalised positions with the scale in the node), and attributes of
 * different types cannot be merged; the console's own material needs no UVs.
 */
function plain(geometry: BufferGeometry): BufferGeometry {
  const copy = new BufferGeometry();
  const position = geometry.getAttribute('position');
  copy.setAttribute('position', floats(position));
  const normal = geometry.getAttribute('normal');
  if (normal) copy.setAttribute('normal', floats(normal));
  if (geometry.index) copy.setIndex(Array.from(geometry.index.array));
  else copy.setIndex(Array.from({ length: position.count }, (_, i) => i));
  if (!normal) copy.computeVertexNormals();
  return copy;
}

const scratchFrom = new Vector3();
const scratchTo = new Vector3();

/**
 * A mesh's outline, hidden: its edges (`EdgesGeometry`) with their line distances, which a dashed material
 * reads, made **once** here and shared by every instance. The distances are in metres: a quantised part's
 * geometry is in the units of its node's scale, so each is multiplied by the mesh's scale in the template.
 */
function outlineOf(mesh: Mesh, table: MaterialTable): LineSegments {
  const geometry = new EdgesGeometry(mesh.geometry, OUTLINE_THRESHOLD_DEG);
  const world = mesh.getWorldScale(new Vector3());
  const scale = (world.x + world.y + world.z) / 3;
  const position = geometry.getAttribute('position');
  const distances = new Float32Array(position.count);
  for (let i = 0; i + 1 < position.count; i += 2) {
    scratchFrom.fromBufferAttribute(position, i);
    scratchTo.fromBufferAttribute(position, i + 1);
    distances[i + 1] = scratchFrom.distanceTo(scratchTo) * scale;
  }
  geometry.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1));
  const outline = new LineSegments(geometry, table.line({ edge: 'idle', severity: null }));
  outline.name = OUTLINE_NAME;
  outline.visible = false;
  return outline;
}

/** The suffix of the lower level of detail's node: `<Root>_LOD1` (V2-13.1; `ops/model-tools/rules.ts` checks the same). */
const LOD1_SUFFIX = '_LOD1';

/** Meshes of a model waiting to be merged: each one's geometry and its transform relative to the class root. */
type MergeList = Map<string, { geometry: BufferGeometry; matrix: Matrix4 }[]>;

/**
 * One merged mesh per console material of `parts`, named `<prefix><Material>`: the geometry of the pieces is brought to
 * the class root's frame and joined, and the pieces are freed. Throws when a material's pieces cannot be joined.
 */
function mergedMeshes(parts: MergeList, table: MaterialTable, prefix: string): Mesh[] {
  const made: Mesh[] = [];
  for (const [name, list] of parts) {
    const pieces = list.map(({ geometry, matrix }) => plain(geometry).applyMatrix4(matrix));
    const merged = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    if (merged === null) {
      for (const mesh of made) mesh.geometry.dispose();
      throw new Error(`the parts in ${name} could not be merged`);
    }
    const mesh = new Mesh(merged, table.get(name));
    mesh.name = `${prefix}${name}`;
    made.push(mesh);
  }
  return made;
}

/**
 * The lower level of detail as a group of merged meshes (V2-19.5), or `null` when `sibling` is missing, holds no mesh, or
 * cannot be merged: LOD1 is an optimisation, so a bad one costs the class its lower level and never its model. Meshes are
 * taken wherever they sit under the sibling (the node itself may be the mesh), with the transform relative to the class
 * root (`toRoot`), which is right whatever the sibling's own pivot or nesting. Their vendor materials are added to
 * `vendorMaterials`, to be freed with the others.
 */
function mergeLod1(
  sibling: Object3D | undefined,
  toRoot: Matrix4,
  table: MaterialTable,
  vendorMaterials: Set<Material>,
): Group | null {
  if (sibling === undefined) return null;
  const parts: MergeList = new Map();
  sibling.traverse((node) => {
    if (!isMesh(node)) return;
    const given = Array.isArray(node.material) ? node.material[0] : node.material;
    if (given) vendorMaterials.add(given);
    const name = table.get(given?.name).name;
    const list = parts.get(name) ?? [];
    list.push({ geometry: node.geometry, matrix: toRoot.clone().multiply(node.matrixWorld) });
    parts.set(name, list);
  });
  if (parts.size === 0) return null;
  try {
    const level = new Group();
    level.name = '_lod1';
    level.add(...mergedMeshes(parts, table, '_lod1_'));
    return level;
  } catch {
    return null;
  }
}

/** Everything a vendor material owns that holds memory: itself and its textures. */
function disposeVendorMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

/**
 * Makes a class template of a loaded glTF scene.
 *
 * - The class root is the scene's child that is not a `…_LOD1` sibling. A scene with no class root throws, which the
 *   caller treats as a failed model.
 * - **LOD1** (V2-19.5) is the sibling named exactly `<root>_LOD1`: its meshes, wherever they sit under it, are merged
 *   like the statics (one mesh per console material, in the class root's frame) into `lod1`; with none, or one that
 *   cannot be merged, the class is LOD0 only. Its outlines are made like LOD0's, so the stale and severity edges read
 *   at a distance too. `switchDistanceM` comes from the sphere around the LOD0 model (`lodDistance`).
 * - Every mesh's material is replaced by the console's of the same name (`table`).
 * - **Static** meshes (no `bind` on them or on an ancestor) are merged, with their transform relative to the
 *   class root baked in, into one mesh per console material: ADR-0020's "static nodes are merged at load".
 *   Merging happens once per class; every instance shares the result.
 * - **Bound** parts stay as objects, moved under the new root with their world transform kept (`attach`), so
 *   a pivot that sat under a static parent still sits where the vendor put it. A bound part's own children
 *   (static or bound) stay under it and move with it: they are not merged.
 * - Every mesh gets a hidden outline (`OUTLINE_NAME`), built once and shared by the copies: the looks of
 *   V2-14.9 show it when they need an edge.
 * - What is not kept (the original static meshes, the loaded LOD1, the vendor's materials and their textures) is
 *   disposed, so a parsed file does not stay in memory twice.
 */
export function buildTemplate(scene: Object3D, table: MaterialTable): ClassTemplate {
  const source = scene.children.find((child) => !child.name.endsWith(LOD1_SUFFIX));
  if (source === undefined) throw new Error('the model has no class root');

  const info = nodeInfoOf(source);
  scene.updateMatrixWorld(true);
  const toRoot = source.matrixWorld.clone().invert();

  const root = new Group();
  root.name = source.name;
  const vendorMaterials = new Set<Material>();
  const statics: MergeList = new Map();

  /** Replaces the materials of `object` and everything under it. */
  const swapMaterials = (object: Object3D): void => {
    object.traverse((node) => {
      if (!isMesh(node)) return;
      const given = Array.isArray(node.material) ? node.material[0] : node.material;
      if (given) vendorMaterials.add(given);
      node.material = table.get(given?.name);
    });
  };

  const walk = (parent: Object3D): void => {
    for (const child of [...parent.children]) {
      if (isBound(child)) {
        root.attach(child);
        child.applyMatrix4(toRoot);
        swapMaterials(child);
        continue;
      }
      if (isMesh(child)) {
        const given = Array.isArray(child.material) ? child.material[0] : child.material;
        if (given) vendorMaterials.add(given);
        const name = table.get(given?.name).name;
        const list = statics.get(name) ?? [];
        list.push({ geometry: child.geometry, matrix: toRoot.clone().multiply(child.matrixWorld) });
        statics.set(name, list);
      }
      walk(child);
    }
  };
  walk(source);

  root.add(...mergedMeshes(statics, table, '_static_'));

  // The lower level (V2-19.5), merged the same way, into its own group: a LOD1 that cannot be merged is no LOD1.
  const lod1 = mergeLod1(
    scene.children.find((child) => child.name === `${source.name}${LOD1_SUFFIX}`),
    toRoot,
    table,
    vendorMaterials,
  );
  // 5 % of the screen's height is measured on the sphere around the LOD0 model, at its authored pose.
  const sphere =
    lod1 === null ? null : new Box3().setFromObject(root).getBoundingSphere(new Sphere());
  const switchDistanceM = sphere === null ? Infinity : lodDistance(sphere.radius, HOME_FOV_DEG);

  // A hidden outline on every mesh of both levels, for the looks that need one (V2-14.9). A bound part's outline moves
  // with it. A level that is not drawn draws no outline, whatever the look.
  const levels = lod1 === null ? [root] : [root, lod1];
  const meshes: Mesh[] = [];
  for (const level of levels) {
    level.traverse((node) => {
      if (isMesh(node)) meshes.push(node);
    });
  }
  for (const mesh of meshes) mesh.add(outlineOf(mesh, table));

  // What is left of the loaded scene is not used by the template.
  scene.traverse((node) => {
    if (isMesh(node)) node.geometry.dispose();
  });
  for (const material of vendorMaterials) disposeVendorMaterial(material);

  return {
    root,
    lod1,
    switchDistanceM,
    info,
    materials: table,
    dispose() {
      for (const level of levels) {
        level.traverse((node) => {
          if (isMesh(node) || isLines(node)) node.geometry.dispose();
        });
      }
    },
  };
}

/**
 * A copy of the template for one asset. Geometry and materials are shared with the template and with every
 * other copy; the bound parts are separate objects with their own transform, found by name
 * (`getObjectByName`), so V2-14.8 can move one asset's fan without touching the other's.
 *
 * A class with a LOD1 gets a three.js `LOD` (V2-19.5) named as the class root: level 0 is the copy of the root, level
 * 1 a copy of `lod1`, drawn from `switchDistanceM` (the renderer updates it, with `LOD_HYSTERESIS` against flicker).
 * **The bound parts are in level 0 only**, so below the threshold their motion and their state tint are not drawn
 * (a static silhouette; sub-pixel by the brief's reckoning, small by the arithmetic: Q3 of the ticket). The looks of the
 * asset reach level 1 anyway: `useModelLooks` paints every mesh of the instance, and `addModel` registers every one.
 * A class without a LOD1 gets the plain copy of the root, as before.
 */
export function instantiate(template: ClassTemplate): Object3D {
  const { root, lod1, switchDistanceM } = template;
  if (lod1 === null || !Number.isFinite(switchDistanceM)) return root.clone(true);
  const lod = new LOD();
  lod.name = root.name;
  const far = lod1.clone(true);
  // Level 1 starts hidden: three lowers a level's threshold by the hysteresis while it is shown, so a LOD1 that began
  // visible would be chosen from 10 % short of the distance on the first update, and the swap would not be symmetric.
  far.visible = false;
  lod.addLevel(root.clone(true), 0);
  lod.addLevel(far, switchDistanceM, LOD_HYSTERESIS);
  return lod;
}
