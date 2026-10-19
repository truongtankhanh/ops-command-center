import { createContext, useContext } from 'react';
import type { Picker } from './picker';

/**
 * The picker `PickLayer` makes, for the components that draw what can be hit (V2-15.3): `Buildings`,
 * `AssetBoxes` and `Equipment` register their meshes with it. `null` outside a `PickLayer`, so they register
 * nothing when rendered without one (their tests, a stage with no canvas) and need no `if` of their own.
 */
export const PickContext = createContext<Picker | null>(null);

export function usePicker(): Picker | null {
  return useContext(PickContext);
}
