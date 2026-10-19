import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  type BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type LineSegments,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { type BoxRange, buildBoxGeometry, edgeIndices } from '../lib/twinBoxes';
import { type AssetLook, edgeColour, faceColour, lookOf } from '../lib/twinMaterials';
import type { PlacedAsset } from '../lib/twinPlacement';
import type { TwinFeed } from '../realtime/twinFeed';
import { twinColors } from '../styles/tokens';
import { type MaterialTable, OUTLINE_NAME } from './classModel';

/*
 * How the equipment looks, painted without React (V2-14.9): stale grey with dashed edges, the severity tint and
 * edge of an open incident (frames 04, 05 and 15). `lookOf` (`lib/twinMaterials.ts`) decides; the hooks here
 * only paint what it says. Each is one `useFrame` that reads `feed.read().flags(code)` and acts only for an
 * asset whose flags **object** changed (the feed keeps one until a field changes) and whose look changed with
 * it, so a quiet scene does nothing, and a flags change that does not move the look (the rule's key arriving)
 * does nothing either. Hover and selection are not passed yet: the 3D stage cannot hover or pick before V2-15,
 * and the store's `hoveredAssetCode` is driven by the 2D map and the Assets tab, so reading it here would tint
 * an asset in 3D for a row hovered elsewhere.
 */

/** The look as a string, to tell whether it changed. Built only when an asset's flags changed. */
const keyOf = (look: AssetLook): string => `${look.face}|${look.edge}|${look.severity ?? ''}`;

// --- models ---------------------------------------------------------------------------------------------------

/** A model instance whose look is painted: its asset, its object, and the table that pools the looks' materials. */
export interface ModelLookTarget {
  assetCode: string;
  object: Object3D;
  materials: MaterialTable;
}

/** One mesh of an instance, the name of the console material it starts in, and its hidden outlines. */
interface ModelPart {
  mesh: Mesh;
  name: string;
  outlines: LineSegments[];
}

interface TrackedModel {
  assetCode: string;
  materials: MaterialTable;
  parts: ModelPart[];
}

function trackModels(targets: readonly ModelLookTarget[]): TrackedModel[] {
  return targets.map(({ assetCode, object, materials }) => {
    const parts: ModelPart[] = [];
    object.traverse((node) => {
      if ((node as Mesh).isMesh !== true) return;
      const mesh = node as Mesh;
      parts.push({
        mesh,
        name: (mesh.material as Material).name,
        outlines: mesh.children.filter((child) => child.name === OUTLINE_NAME) as LineSegments[],
      });
    });
    return { assetCode, materials, parts };
  });
}

/**
 * Points every mesh of an instance at the pooled material of its look and shows its outlines in the edge of the
 * look, or hides them for `idle`. A function of its own and not a block of the frame callback: it writes to
 * objects the hook's memo made, which the React Compiler rules would not let a hook body do.
 */
function paintModel(model: TrackedModel, look: AssetLook): void {
  for (const part of model.parts) {
    part.mesh.material = model.materials.look(part.name, look);
    for (const outline of part.outlines) {
      outline.visible = look.edge !== 'idle';
      if (look.edge !== 'idle') outline.material = model.materials.line(look);
    }
  }
}

/** What the model hook remembers between frames, in a ref: the instances it was set up for, and per instance the last flags and look. */
interface ModelMemory {
  tracked: readonly TrackedModel[] | null;
  flags: unknown[];
  keys: string[];
}

/**
 * Paints the looks of the model instances (Q3): each mesh is re-pointed at a pooled material for its
 * (name, face, severity), never a clone per instance, and each outline is shown for the looks that need an edge
 * (a stale dash, a severity) and hidden for `idle`, so an idle model draws exactly what it drew before.
 */
export function useModelLooks(feed: TwinFeed | null, targets: readonly ModelLookTarget[]): void {
  const tracked = useMemo(() => trackModels(targets), [targets]);
  const memory = useRef<ModelMemory>({ tracked: null, flags: [], keys: [] });

  useFrame(() => {
    if (feed === null || tracked.length === 0) return;
    const reader = feed.read();
    const last = memory.current;
    if (last.tracked !== tracked) {
      last.tracked = tracked;
      last.flags = new Array<unknown>(tracked.length).fill(undefined);
      last.keys = new Array<string>(tracked.length).fill('');
    }
    for (let index = 0; index < tracked.length; index += 1) {
      const model = tracked[index];
      if (model === undefined) continue;
      const flags = reader.flags(model.assetCode);
      if (flags === last.flags[index]) continue;
      last.flags[index] = flags;
      const look = lookOf(flags, false, false);
      const key = keyOf(look);
      if (key === last.keys[index]) continue;
      last.keys[index] = key;
      paintModel(model, look);
    }
  });
}

// --- boxes ----------------------------------------------------------------------------------------------------

/**
 * The geometry of the neutral boxes, ready to be painted (Q2). The faces are one mesh with a `color` attribute;
 * the edges are **two** line geometries that share one set of vertex data (position, colour and line
 * distance) and differ only in their index: a solid layer, and a dashed one for the assets that are stale.
 * A change of look rewrites colours in place and, when the set of stale assets changed, the two small index
 * lists; the vertices are never rebuilt.
 */
export interface BoxLayers {
  faces: BufferGeometry;
  solid: BufferGeometry;
  dashed: BufferGeometry;
  faceColours: BufferAttribute;
  edgeColours: BufferAttribute;
  /** Per asset, in the geometry's order: its vertices, triangles and segments. */
  ranges: readonly BoxRange[];
}

/** `count` vertices all in one colour, in the linear space three's vertex colours are in. */
function filled(count: number, hex: string): Float32BufferAttribute {
  const color = new Color(hex);
  const array = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    array[3 * vertex] = color.r;
    array[3 * vertex + 1] = color.g;
    array[3 * vertex + 2] = color.b;
  }
  return new Float32BufferAttribute(array, 3);
}

/** The layers of `placed`, every asset idle: the neutral faces, the idle outline, every segment solid. */
export function createBoxLayers(placed: readonly PlacedAsset[]): BoxLayers {
  const { positions, normals, indices, edges, lineDistances, ranges } = buildBoxGeometry(placed);

  const faceColours = filled(positions.length / 3, twinColors.neutral);
  const faces = new BufferGeometry();
  faces.setAttribute('position', new Float32BufferAttribute(positions, 3));
  faces.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  faces.setAttribute('color', faceColours);
  faces.setIndex(indices);

  const edgePosition = new Float32BufferAttribute(edges, 3);
  const edgeColours = filled(edges.length / 3, twinColors.edge);
  const edgeDistance = new Float32BufferAttribute(lineDistances, 1);
  const layer = (index: number[]): BufferGeometry => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', edgePosition);
    geometry.setAttribute('color', edgeColours);
    geometry.setAttribute('lineDistance', edgeDistance);
    geometry.setIndex(index);
    return geometry;
  };
  const { solid, dashed } = edgeIndices(ranges, new Set());

  return { faces, solid: layer(solid), dashed: layer(dashed), faceColours, edgeColours, ranges };
}

const scratch = new Color();

/**
 * Paints one asset's look into the layers: its face vertices and its edge vertices, in place. A function of
 * its own and not a block of the frame callback, like `paintModel`, because it writes to objects a hook's memo
 * made.
 */
function paintBox(layers: BoxLayers, range: BoxRange, look: AssetLook): void {
  scratch.set(faceColour(twinColors.neutral, look));
  for (let v = range.firstVertex; v < range.firstVertex + range.vertexCount; v += 1) {
    layers.faceColours.setXYZ(v, scratch.r, scratch.g, scratch.b);
  }
  layers.faceColours.needsUpdate = true;

  scratch.set(edgeColour(look));
  for (let v = 2 * range.firstSegment; v < 2 * (range.firstSegment + range.segmentCount); v += 1) {
    layers.edgeColours.setXYZ(v, scratch.r, scratch.g, scratch.b);
  }
  layers.edgeColours.needsUpdate = true;
}

/** Moves the segments of the stale assets to the dashed layer and the rest to the solid one. */
function splitEdges(layers: BoxLayers, dashedCodes: ReadonlySet<string>): void {
  const { solid, dashed } = edgeIndices(layers.ranges, dashedCodes);
  layers.solid.setIndex(solid);
  layers.dashed.setIndex(dashed);
}

interface BoxMemory {
  layers: BoxLayers | null;
  flags: unknown[];
  keys: string[];
  /** The assets whose edge is `stale-dashed` now. */
  dashed: Set<string>;
}

/**
 * Paints the looks of the neutral boxes (Q2): per asset, the vertex colours of its faces and edges; the
 * segments of a stale asset go to the dashed layer, and a stale fault keeps a **solid** severity edge, so it
 * stays in the solid layer. As for the models, only an asset whose flags object changed, and whose look changed
 * with it, is touched.
 */
export function useBoxLooks(feed: TwinFeed | null, layers: BoxLayers | null): void {
  const memory = useRef<BoxMemory>({ layers: null, flags: [], keys: [], dashed: new Set() });

  useFrame(() => {
    if (feed === null || layers === null) return;
    const reader = feed.read();
    const last = memory.current;
    if (last.layers !== layers) {
      last.layers = layers;
      last.flags = new Array<unknown>(layers.ranges.length).fill(undefined);
      last.keys = new Array<string>(layers.ranges.length).fill('');
      last.dashed = new Set();
    }
    let dashedChanged = false;
    for (let index = 0; index < layers.ranges.length; index += 1) {
      const range = layers.ranges[index];
      if (range === undefined) continue;
      const flags = reader.flags(range.code);
      if (flags === last.flags[index]) continue;
      last.flags[index] = flags;
      const look = lookOf(flags, false, false);
      const key = keyOf(look);
      if (key === last.keys[index]) continue;
      last.keys[index] = key;
      paintBox(layers, range, look);
      const wasDashed = last.dashed.has(range.code);
      const isDashed = look.edge === 'stale-dashed';
      if (wasDashed === isDashed) continue;
      if (isDashed) last.dashed.add(range.code);
      else last.dashed.delete(range.code);
      dashedChanged = true;
    }
    if (dashedChanged) splitEdges(layers, last.dashed);
  });
}
