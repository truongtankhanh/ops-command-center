import {
  type BufferAttribute,
  BufferGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  type InterleavedBufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  type Material,
  type Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  Texture,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { NodeInfo } from '../lib/twinBindings';
import {
  type AssetLook,
  EDGE_DASH_M,
  EDGE_GAP_M,
  edgeColour,
  faceColour,
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
  /** The same material under a look: its colour for the face (`faceColour`), the same opacity. `idle` is `get`. */
  look(name: string | undefined, look: Pick<AssetLook, 'face' | 'severity'>): MeshLambertMaterial;
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
      if (look.face === 'idle') return table.get(name);
      const { name: resolved, color, opacity } = materialSpec(name);
      // Only an alarmed face depends on the severity.
      const key = `${resolved}|${look.face}|${look.face === 'alarm' ? look.severity : ''}`;
      let material = made.get(key);
      if (material === undefined) {
        material = faceMaterial(resolved, faceColour(color, look), opacity);
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
  /** The class root: the merged static parts and the bound parts, at the model's own origin. */
  root: Group;
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
 * - The class root is the scene's child that is not a `…_LOD1` sibling. LOD1 is dropped here (V2-19.5 owns
 *   level of detail). A scene with no class root throws, which the caller treats as a failed model.
 * - Every mesh's material is replaced by the console's of the same name (`table`).
 * - **Static** meshes (no `bind` on them or on an ancestor) are merged, with their transform relative to the
 *   class root baked in, into one mesh per console material: ADR-0020's "static nodes are merged at load".
 *   Merging happens once per class; every instance shares the result.
 * - **Bound** parts stay as objects, moved under the new root with their world transform kept (`attach`), so
 *   a pivot that sat under a static parent still sits where the vendor put it. A bound part's own children
 *   (static or bound) stay under it and move with it: they are not merged.
 * - Every mesh gets a hidden outline (`OUTLINE_NAME`), built once and shared by the copies: the looks of
 *   V2-14.9 show it when they need an edge.
 * - What is not kept (the original static meshes, LOD1, the vendor's materials and their textures) is
 *   disposed, so a parsed file does not stay in memory twice.
 */
export function buildTemplate(scene: Object3D, table: MaterialTable): ClassTemplate {
  const source = scene.children.find((child) => !child.name.endsWith('_LOD1'));
  if (source === undefined) throw new Error('the model has no class root');

  const info = nodeInfoOf(source);
  scene.updateMatrixWorld(true);
  const toRoot = source.matrixWorld.clone().invert();

  const root = new Group();
  root.name = source.name;
  const vendorMaterials = new Set<Material>();
  const statics = new Map<string, { geometry: BufferGeometry; matrix: Matrix4 }[]>();

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

  for (const [name, parts] of statics) {
    const pieces = parts.map(({ geometry, matrix }) => plain(geometry).applyMatrix4(matrix));
    const merged = mergeGeometries(pieces);
    for (const piece of pieces) piece.dispose();
    if (merged === null) throw new Error(`the static parts in ${name} could not be merged`);
    const mesh = new Mesh(merged, table.get(name));
    mesh.name = `_static_${name}`;
    root.add(mesh);
  }

  // A hidden outline on every mesh, for the looks that need one (V2-14.9). A bound part's outline moves with it.
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  for (const mesh of meshes) mesh.add(outlineOf(mesh, table));

  // What is left of the loaded scene is not used by the template.
  scene.traverse((node) => {
    if (isMesh(node)) node.geometry.dispose();
  });
  for (const material of vendorMaterials) disposeVendorMaterial(material);

  return {
    root,
    info,
    materials: table,
    dispose() {
      root.traverse((node) => {
        if (isMesh(node) || isLines(node)) node.geometry.dispose();
      });
    },
  };
}

/**
 * A copy of the template for one asset. Geometry and materials are shared with the template and with every
 * other copy; the bound parts are separate objects with their own transform, found by name
 * (`getObjectByName`), so V2-14.8 can move one asset's fan without touching the other's.
 */
export function instantiate(template: ClassTemplate): Object3D {
  return template.root.clone(true);
}
