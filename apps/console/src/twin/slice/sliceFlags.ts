import { createContext, useContext } from 'react';

/*
 * SPIKE (V3-11.5, branch `spike/V3-11-realism-slice`, never merged): the realism slice's switches. Each element of the
 * slice is turned on from the address so V3-11.6 can measure it alone and combined (V3-11.1's protocol). With no
 * `slice` parameter every switch is off and the scene is `main`'s.
 *
 * `?slice=` takes a comma-separated list: `textures`, `facades`, `shadow`, `trees=0|1|2`, and `all` (the three
 * switches with trees at `1`, unless a `trees=` item says otherwise). An unknown item is ignored.
 *
 * Read once when the stage mounts, like `debugTwinRequested`: sign-in drops the query (V3-11.8), so the measurer puts
 * it back with `history.replaceState` and switches 2D → 3D, which mounts the stage again.
 */

export type TreeDensity = 0 | 1 | 2;

export interface SliceFlags {
  textures: boolean;
  facades: boolean;
  shadow: boolean;
  trees: TreeDensity;
}

export const NO_SLICE: SliceFlags = { textures: false, facades: false, shadow: false, trees: 0 };

const TREE_ITEM = /^trees=([012])$/;

/** The switches in `search` (a `location.search`). Never throws: an address it cannot read is no slice. */
export function parseSliceFlags(search: string): SliceFlags {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get('slice');
  } catch {
    return NO_SLICE;
  }
  if (!value) return NO_SLICE;
  const flags: SliceFlags = { ...NO_SLICE };
  let trees: TreeDensity | null = null;
  for (const item of value.split(',').map((part) => part.trim())) {
    if (item === 'all') {
      flags.textures = flags.facades = flags.shadow = true;
      flags.trees = 1;
    } else if (item === 'textures' || item === 'facades' || item === 'shadow') {
      flags[item] = true;
    } else {
      const match = TREE_ITEM.exec(item);
      if (match) trees = Number(match[1]) as TreeDensity;
    }
  }
  // An explicit `trees=` wins over `all`'s default, wherever it appears in the list.
  if (trees !== null) flags.trees = trees;
  return flags;
}

export const sliceActive = (flags: SliceFlags): boolean =>
  flags.textures || flags.facades || flags.shadow || flags.trees > 0;

/** The line logged once per stage mount, so the results sheet records what ran. */
export function describeSlice(flags: SliceFlags): string {
  const on = (['textures', 'facades', 'shadow'] as const).filter((name) => flags[name]);
  return `[slice] ${[...on, `trees=${flags.trees}`].join(', ')}`;
}

/** The flags for the components under the canvas that are not handed them as props (`Buildings`, `Equipment`). */
export const SliceContext = createContext<SliceFlags>(NO_SLICE);

export const useSliceFlags = (): SliceFlags => useContext(SliceContext);
