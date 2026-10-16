import { useConsole } from '../store';
import { type TwinCapability, twinCapability } from './twinCapability';

/**
 * The twin's capability for a component: `twinCapability` with the fault the 3D stage may have
 * reported (`twinFault` in the store), so a lost context re-renders every reader. It subscribes to
 * the fault only, a string or `null`; the gate and the WebGL probe do not change during a session.
 *
 * In `lib/` with the other hooks. The fault is an argument of `twinCapability` and not an import of
 * the store there, because the store imports that module.
 */
export function useTwinCapability(): TwinCapability {
  return twinCapability(useConsole((s) => s.twinFault));
}
