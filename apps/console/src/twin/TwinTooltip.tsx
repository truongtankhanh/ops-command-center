import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssets, useCameras, useIncidents, useZones } from '../api/queries';
import { AssetTip, CameraTip, IncidentTip } from '../components/Tips';
import { tipSurface } from '../components/tipSurface';
import { placeLabel } from '../lib/assets';
import { isActive } from '../lib/incidents/incidents';
import { onPick } from '../lib/twinPicker';
import type { PickRef, ScreenPoint } from '../lib/twinPicking';
import { placeTip, TIP_DELAY_MS } from '../lib/twinTooltip';
import { useConsole } from '../store';
import styles from './TwinTooltip.module.css';
import { sheetInset } from './useSheetOffset';

/** What a tooltip can be about: the kinds of hover that have a body (V2-15.5; an incident's beacon, V2-16.4). */
interface Target {
  kind: 'asset' | 'camera' | 'incident';
  id: string;
}

const targetOf = (ref: PickRef | null): Target | null => {
  if (ref?.kind === 'asset' || ref?.kind === 'camera') return { kind: ref.kind, id: ref.id };
  return ref?.kind === 'beacon' ? { kind: 'incident', id: ref.id } : null;
};

const sameTarget = (a: Target | null, b: Target | null): boolean =>
  a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);

/** Writes the tooltip's place: the pointer's, kept inside the stage and clear of the open sheet. */
function place(tip: HTMLElement, layer: HTMLElement, pointer: ScreenPoint): void {
  const { left, top } = placeTip(
    pointer,
    { width: tip.offsetWidth, height: tip.offsetHeight },
    { width: layer.clientWidth, height: layer.clientHeight },
    sheetInset(layer),
  );
  tip.style.transform = `translate(${left}px, ${top}px)`;
}

/**
 * The tooltip of the 3D view (V2-15.5, frame 02): what the pointer rests on, said with the bodies the 2D map's
 * tooltip uses (`components/Tips.tsx`), at the pointer. An asset gets its name, code, state word, two headline
 * readings and where a click leads (the place line, or "No 3D model · drawn as a box"); a camera gets its name
 * and code; an incident's beacon (V2-16.4) gets the map's incident tooltip (title, severity, status, code, zone and
 * age), for an incident that is active or selected, as the map's, so one that has just left the picture says
 * nothing. A part, a building and nothing get none: the part's words are the callout's (V2-15.10) and the
 * building's the summary's (V2-15.9). It follows the **pick** (`onPick`), not `hoveredAssetCode`: a row hovered
 * in the Assets tab tints the asset but there is no pointer on the canvas to put a tooltip beside.
 *
 * - It shows after `TIP_DELAY_MS` of resting on the same target (a new target starts the wait again), for a
 *   mouse or a pen over the canvas. A press, a wheel turn, leaving the stage, a touch, or picking the report's
 *   location hide it, and it stays hidden until the pointer moves again: after a click the camera flies and
 *   after a drag it keeps moving with no `pointermove`, and the pick under the pointer is stale then
 *   (V2-15.4's known gap); the tint is not fixed here, the tooltip only does not describe the wrong thing.
 * - It is decoration, as the map's: `aria-hidden` and never interactive (`pointer-events: none`); the Assets tab
 *   and the inspector are the keyboard and screen-reader route. It reads only what the console already holds
 *   (the catalogue, the incidents and the 1 Hz overview, through the bodies): never a watch, never a new number.
 * - The place is written to the element's style from the pointer handler, not held in state: a pointer move
 *   must not render `AssetTip`, which reads the clock and the telemetry store.
 *
 * The layer covers the stage and listens on it (its parent), like `DragHint`.
 */
export function TwinTooltip() {
  const layer = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const pointer = useRef<ScreenPoint>({ x: 0, y: 0 });
  const [shown, setShown] = useState<Target | null>(null);
  const { data: assets } = useAssets();
  const { data: cameras } = useCameras();
  const { data: incidents } = useIncidents();
  const { data: zones } = useZones();
  const selectedIncidentId = useConsole((state) => state.selectedIncidentId);

  useEffect(() => {
    const element = layer.current;
    const stage = element?.parentElement;
    if (!element || !stage) return;

    let candidate: Target | null = null;
    let over = false;
    let suppressed = false;
    /** The target whose wait is running or which is shown. */
    let committed: Target | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sync = (): void => {
      const wanted =
        candidate !== null && over && !suppressed && !useConsole.getState().picking
          ? candidate
          : null;
      if (sameTarget(wanted, committed)) return;
      clearTimeout(timer);
      committed = wanted;
      setShown(null);
      if (wanted !== null) timer = setTimeout(() => setShown(wanted), TIP_DELAY_MS);
    };

    const hide = (): void => {
      suppressed = true;
      sync();
    };
    const onMove = (event: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      over = event.pointerType !== 'touch' && event.target instanceof HTMLCanvasElement;
      suppressed = false;
      if (tip.current) place(tip.current, element, pointer.current);
      sync();
    };
    const onLeave = (): void => {
      over = false;
      sync();
    };

    const stopPick = onPick((ref) => {
      candidate = targetOf(ref);
      sync();
    });
    const stopStore = useConsole.subscribe((state, previous) => {
      if (state.picking !== previous.picking) sync();
    });
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerdown', hide);
    stage.addEventListener('pointerleave', onLeave);
    stage.addEventListener('wheel', hide, { passive: true });
    return () => {
      clearTimeout(timer);
      stopPick();
      stopStore();
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', hide);
      stage.removeEventListener('pointerleave', onLeave);
      stage.removeEventListener('wheel', hide);
    };
  }, []);

  // The tooltip's size is known once it is in the DOM: it is placed before the browser paints it.
  useLayoutEffect(() => {
    if (shown !== null && tip.current && layer.current) {
      place(tip.current, layer.current, pointer.current);
    }
  }, [shown]);

  const zoneOf = (zoneId: string) => zones?.find((zone) => zone.id === zoneId);
  let body: ReactNode = null;
  if (shown?.kind === 'asset') {
    const asset = assets?.find((candidate) => candidate.code === shown.id);
    // An asset the catalogue does not hold has nothing to say.
    if (asset) {
      const zone = zoneOf(asset.zoneId);
      const foot =
        asset.class.modelUrl === null || asset.class.modelUrl === ''
          ? 'No 3D model · drawn as a box'
          : ['Click to inspect', placeLabel(asset, zone)].filter(Boolean).join(' · ');
      body = <AssetTip asset={asset} incidents={incidents ?? []} zone={zone?.name} foot={foot} />;
    }
  } else if (shown?.kind === 'camera') {
    const camera = cameras?.find((candidate) => candidate.id === shown.id);
    if (camera) body = <CameraTip camera={camera} zone={zoneOf(camera.zoneId)?.name} />;
  } else if (shown?.kind === 'incident') {
    const incident = incidents?.find((candidate) => candidate.id === shown.id);
    // The map draws the active incidents and the selected one: anything else has left the picture.
    if (incident && (isActive(incident) || incident.id === selectedIncidentId)) {
      body = <IncidentTip incident={incident} zone={zoneOf(incident.zoneId)?.name} />;
    }
  }

  return (
    <div ref={layer} className={styles.layer} aria-hidden="true">
      {body && (
        <div ref={tip} role="tooltip" className={`${tipSurface} ${styles.tooltip}`}>
          {body}
        </div>
      )}
    </div>
  );
}
