import type { PickDone } from './twinPicker';
import { cursorOf, isClick, type PickRef, type ScreenPoint } from './twinPicking';

/*
 * The pointer on the 3D canvas (V2-15.4, ADR-0020 § Scene, "Settled in V2-15.4"): hover, click and drag as plain
 * DOM logic, with no `three`, no store import and no React, so it tests with synthetic pointer events. It is given
 * what it needs (`PointerDeps`): `twin/Pointer.tsx` wires the real pick seam, the store and the scene's lookups.
 *
 * - A press that ends within `CLICK_SLOP_PX` of where it began is a click; further is a drag, which is the
 *   camera's and does nothing here. The press is followed on the **document** once it has begun, as
 *   `camera-controls` does, so a release over the inspector sheet still ends it.
 * - Hover asks for a pick on each move with no button down; the answer comes through `onPick`. A click asks for
 *   the pick **at its own point** and acts on the answer (`requestPick`'s completion), because `onPick` is silent
 *   when the winner did not change.
 * - A click on a beacon (V2-16.4) selects its incident, and a second click on the selected one deselects it, as the
 *   2D map's click does; it writes no hover (the tooltip follows the pick). It is not role-gated: the sheet's footer
 *   and the API decide what the role may do.
 * - The pointer clears only the hover it wrote, so a hover set by an Assets row is never taken away by the
 *   pointer leaving the canvas.
 */

/** The store actions a click and a hover end in. */
export interface PointerActions {
  hoverAsset(code: string | null): void;
  hoverPart(node: string | null): void;
  toggleAsset(code: string, focusZoneId: string | null): void;
  selectPart(node: string | null): void;
  focusBuilding(zoneId: string): void;
  openViewer(cameraId: string): void;
  /** Selects the incident, or closes the sheet with `null` (the store's `select`). */
  selectIncident(id: string | null): void;
}

export interface PointerDeps {
  /** The pick seam (`lib/twinPicker.ts`). */
  requestPick(point: ScreenPoint, done?: PickDone): void;
  onPick(listener: (ref: PickRef | null) => void): () => void;
  lastPick(): PickRef | null;
  /** The report location is being picked: nothing is clicked, the cursor is a crosshair (V2-16.7 adds the ground). */
  isPicking(): boolean;
  /** What is selected now, read at the moment of a click. */
  selection(): { assetCode: string | null; part: string | null; incidentId: string | null };
  /** The building zone an asset is in (`buildingFocusOf`), or `null`. */
  focusZoneOf(code: string): string | null;
  actions: PointerActions;
}

export interface PointerHandle {
  /** Removes every listener, takes back the hover this wrote and resets the cursor. */
  detach(): void;
  /** Recomputes the cursor: for a change the pointer cannot see, such as `picking` turning on. */
  refresh(): void;
}

interface Press {
  id: number;
  button: number;
  start: ScreenPoint;
  /** A second pointer went down during the press (a pinch): it is the camera's, never a click. */
  multi: boolean;
  /** It has moved further than the click slop. */
  dragging: boolean;
}

export function attachPointer(element: HTMLElement, deps: PointerDeps): PointerHandle {
  const { actions } = deps;
  const doc = element.ownerDocument;

  let press: Press | null = null;
  let waiting = false;
  let over: PickRef | null = deps.lastPick();
  let touch = false;
  let wroteAsset = false;
  let wrotePart = false;

  const pointOf = (event: PointerEvent): ScreenPoint => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const refresh = (): void => {
    element.style.cursor = cursorOf({
      picking: deps.isPicking(),
      dragging: press?.dragging === true,
      overTarget: over !== null,
    });
  };

  const clearHover = (): void => {
    if (wroteAsset) actions.hoverAsset(null);
    if (wrotePart) actions.hoverPart(null);
    wroteAsset = false;
    wrotePart = false;
  };

  /** Writes the hover a pick result means, taking back what the previous one wrote. */
  const hoverFrom = (ref: PickRef | null): void => {
    const asset = ref?.kind === 'asset' ? ref.id : ref?.kind === 'part' ? ref.assetCode : null;
    const part = ref?.kind === 'part' ? ref.id : null;
    if (asset !== null) {
      actions.hoverAsset(asset);
      wroteAsset = true;
    } else if (wroteAsset) {
      actions.hoverAsset(null);
      wroteAsset = false;
    }
    if (part !== null) {
      actions.hoverPart(part);
      wrotePart = true;
    } else if (wrotePart) {
      actions.hoverPart(null);
      wrotePart = false;
    }
  };

  /** What a click on `ref` does (V2-15.4's table); nothing on nothing, and nothing while a location is picked. */
  const act = (ref: PickRef | null): void => {
    if (ref === null || deps.isPicking()) return;
    const selected = deps.selection();
    switch (ref.kind) {
      case 'asset':
        // The body of the isolated asset at part level closes the callout; at asset level it toggles, as the 2D map.
        if (selected.assetCode === ref.id && selected.part !== null) actions.selectPart(null);
        else actions.toggleAsset(ref.id, deps.focusZoneOf(ref.id));
        return;
      case 'part':
        actions.selectPart(
          selected.part === ref.id && selected.assetCode === ref.assetCode ? null : ref.id,
        );
        return;
      case 'building':
        actions.focusBuilding(ref.id);
        return;
      case 'camera':
        actions.openViewer(ref.id);
        return;
      case 'beacon':
        actions.selectIncident(selected.incidentId === ref.id ? null : ref.id);
        return;
    }
  };

  const onPick = (ref: PickRef | null): void => {
    over = ref;
    // A tap is not a hover: nothing would take it back until the next touch.
    if (!touch) hoverFrom(ref);
    refresh();
  };

  const onDown = (event: PointerEvent): void => {
    touch = event.pointerType === 'touch';
    waiting = false;
    if (press !== null) {
      press.multi = true;
      return;
    }
    press = {
      id: event.pointerId,
      button: event.button,
      start: pointOf(event),
      multi: false,
      dragging: false,
    };
    refresh();
  };

  const onMove = (event: PointerEvent): void => {
    touch = event.pointerType === 'touch';
    if (press !== null) {
      // A release the document never heard (the window lost it): the press is over.
      if (event.buttons === 0 && !touch) {
        press = null;
        refresh();
        return;
      }
      if (!press.dragging && !isClick(press.start, pointOf(event))) {
        press.dragging = true;
        refresh();
      }
      return;
    }
    // No hover on a touch screen, none while a location is picked, none while a click waits for its answer.
    if (touch || waiting || deps.isPicking()) return;
    deps.requestPick(pointOf(event));
  };

  const onLeave = (): void => {
    clearHover();
    refresh();
  };

  const onUp = (event: PointerEvent): void => {
    if (press === null || event.pointerId !== press.id) return;
    const ended = press;
    press = null;
    refresh();
    if (ended.multi || ended.button !== 0) return;
    const up = pointOf(event);
    if (!isClick(ended.start, up) || deps.isPicking()) return;
    waiting = true;
    deps.requestPick(up, (ref) => {
      waiting = false;
      act(ref);
    });
  };

  const onCancel = (event: PointerEvent): void => {
    if (press !== null && event.pointerId === press.id) press = null;
    refresh();
  };

  const unsubscribe = deps.onPick(onPick);
  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerleave', onLeave);
  doc.addEventListener('pointerup', onUp);
  doc.addEventListener('pointercancel', onCancel);
  refresh();

  return {
    refresh,
    detach() {
      unsubscribe();
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onCancel);
      clearHover();
      element.style.cursor = '';
    },
  };
}
