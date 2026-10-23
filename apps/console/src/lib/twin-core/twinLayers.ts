import { MAP_LAYER_KEYS, type LayerVisibility, type MapLayerKey } from './map/mapLayers';
import type { SceneLevel } from './twinLevel';
import type { ViewChoice } from './shell/viewChoice';

/*
 * The layers the operator can show or hide, as plain data (V2-15.9): the three of the 2D map (`mapLayers.ts`) and,
 * in the 3D view, `Inside`. It sits beside the map's module and does not extend it: `MapLayerKey`,
 * `LayerVisibility` and `LAYER_GROUPS` are the 2D map's, which has no `Inside` to draw or hide, and widening them
 * would put a 3D layer in its toggle list and its layer groups. The store holds `SceneLayers`, a `LayerVisibility`
 * with the extra keys, so the map keeps reading it as it was. `heat` (V2-17.3) is the same kind of key: the state
 * is here and the overlay reads it, and the control for it is in `layersOf` since V2-17.4.
 *
 * Main-chunk code (`LayersControl` reads it): imports types and the map's key list only, never `src/twin/`.
 */

/** What can be shown or hidden as one: the map's layers and the 3D view's `Inside` and `Heat`. */
export type SceneLayerKey = MapLayerKey | 'inside' | 'heat';

/**
 * Which layers are shown. A `LayerVisibility` plus `Inside` and `Heat`, so the 2D map can read it as it is. `heat`
 * is off by default (the overlay recolours the whole campus, so it is something an operator asks for).
 */
export type SceneLayers = LayerVisibility & { inside: boolean; heat: boolean };

/**
 * The toggles the control offers in `view` at `level`, in order. The 2D map offers its three. The 3D stage has no
 * Assets toggle (equipment is the scene, ADR-0020, V2-12.1) and offers `Inside` at building level only: it is the
 * building level's layer (it draws the focused shell opaque with its equipment hidden), and at asset and part level
 * the isolated asset is drawn whatever it says (`presenceOf`), so a toggle there would do nothing. Its state is kept
 * while it is not offered. Cameras stays at every level: `CameraMarkers` still reads it, and a hidden toggle for a
 * layer that is off would strand it.
 *
 * Heat (V2-17.4) is offered at **every** 3D level, last, for the same reason as Cameras: at asset and part level it
 * draws nothing different, but a toggle that vanishes while it is on would strand the state and make the next
 * level change a surprise. What follows the level is the picker and the legend (`showsHeat`), not this list.
 */
export function layersOf(view: ViewChoice, level: SceneLevel): readonly SceneLayerKey[] {
  if (view === '2d') return MAP_LAYER_KEYS;
  return level === 'building'
    ? ['incidents', 'cameras', 'inside', 'heat']
    : ['incidents', 'cameras', 'heat'];
}
