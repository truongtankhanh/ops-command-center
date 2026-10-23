import type { Vec3 } from './twinCamera';
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
 * - While a report location is picked (V2-16.7) a click asks for the pick at its point as usual, but the answer is a
 *   **place** (a `ground` ref: the nearest of the roofs and the ground) and the one thing done with it is `placePin`;
 *   nothing else is clicked or hovered, and the cursor is a crosshair. An answer that is a thing, or that arrives
 *   after picking ended, does nothing.
 * - **The report's pin can be dragged** while the location is picked (V2-16.7). Whether a press is on the pin is decided
 *   at once, in a **capture-phase** `pointerdown` on the canvas (`deps.pinAt`, a screen-space test), and a press on it
 *   is stopped there so the camera's controls never hear it and never start an orbit. The drag then follows the
 *   pointer with pointer capture: each move asks for the place under it and shows the pin there (`previewPin`), the
 *   release asks once more and drops it (`dropPin`, where the caller places it if it lies in a zone and puts it back
 *   if not), and a cancel, a lost release or a second pointer (a pinch) drops it nowhere (`dropPin(null)`).
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
  /** Places the report's pin at a point of the scene (metres), while a location is picked (V2-16.7). */
  placePin(point: Vec3): void;
  /** Shows the pin being dragged at a place of the scene (metres); nothing is placed until it is dropped (V2-16.7). */
  previewPin(point: Vec3): void;
  /** The pin was let go at `point`, or `null` when the drag was cancelled; the preview ends either way (V2-16.7). */
  dropPin(point: Vec3 | null): void;
}

export interface PointerDeps {
  /** The pick seam (`lib/twinPicker.ts`). */
  requestPick(point: ScreenPoint, done?: PickDone): void;
  onPick(listener: (ref: PickRef | null) => void): () => void;
  lastPick(): PickRef | null;
  /**
   * Whether the report's pin is under `point` on the screen right now (`lib/twinPicker.ts` `pinUnderPoint`); it must
   * answer at once, because the press has to decide before the camera's controls hear it. `false` unless the pin is
   * drawn and a location is picked.
   */
  pinAt(point: ScreenPoint): boolean;
  /** The report location is being picked: a click places the pin and nothing else is clicked, the cursor is a crosshair (V2-16.7). */
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
  /**
   * A drag of the report's pin: the pointer that holds it, the last place it was shown at, and whether it has been let go
   * (the drop waits for the next frame's pick, and a move in between is not a cancel).
   */
  let pinDrag: { id: number; lastPlace: Vec3 | null; releasing: boolean } | null = null;
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

  /**
   * What a click on `ref` does (V2-15.4's table); nothing on nothing. While a location is picked (V2-16.7) the only
   * thing a click does is place the pin, at the place the pick answered, and a thing is not a place.
   */
  const act = (ref: PickRef | null): void => {
    if (ref === null) return;
    if (deps.isPicking()) {
      if (ref.kind === 'ground') actions.placePin([ref.x, ref.y, ref.z]);
      return;
    }
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
      case 'ground':
        // A place, not a thing: only picking a location acts on it, and that returned above (V2-16.7).
        return;
    }
  };

  const onPick = (ref: PickRef | null): void => {
    over = ref;
    // A tap is not a hover: nothing would take it back until the next touch.
    if (!touch) hoverFrom(ref);
    refresh();
  };

  /** The place a pick answered, or `null` for nothing or for a thing. */
  const placeOf = (ref: PickRef | null): Vec3 | null =>
    ref?.kind === 'ground' ? [ref.x, ref.y, ref.z] : null;

  /** Ends the pin drag, dropping the pin at `at` (`null`: nowhere, the drag was cancelled). */
  const endPinDrag = (at: Vec3 | null): void => {
    if (pinDrag === null) return;
    const { id } = pinDrag;
    pinDrag = null;
    try {
      element.releasePointerCapture(id);
    } catch {
      // Not captured (or the pointer is gone): nothing to give back.
    }
    actions.dropPin(at);
    refresh();
  };

  const onDown = (event: PointerEvent): void => {
    touch = event.pointerType === 'touch';
    waiting = false;
    if (pinDrag !== null) {
      // A second pointer while the pin is held is a pinch: the pin is let go where it started.
      endPinDrag(null);
      return;
    }
    if (press !== null) {
      press.multi = true;
      return;
    }
    if (event.button === 0 && deps.isPicking() && deps.pinAt(pointOf(event))) {
      // The camera's controls listen to this same press: stop it before they do (this runs in the capture phase).
      event.stopImmediatePropagation();
      pinDrag = { id: event.pointerId, lastPlace: null, releasing: false };
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // No pointer capture (a test, an old browser): the moves over the canvas still arrive.
      }
      refresh();
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
    if (pinDrag !== null) {
      if (event.pointerId !== pinDrag.id || pinDrag.releasing) return;
      // A release the document never heard (the window lost it): the pin is let go where it started.
      if (event.buttons === 0 && !touch) {
        endPinDrag(null);
        return;
      }
      deps.requestPick(pointOf(event), (ref) => {
        const place = placeOf(ref);
        if (pinDrag === null || place === null) return;
        pinDrag.lastPlace = place;
        actions.previewPin(place);
      });
      return;
    }
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
    if (pinDrag !== null) {
      if (event.pointerId !== pinDrag.id || pinDrag.releasing) return;
      // One more pick at the release point; a ray that finds nothing there drops the pin at the last place it was shown.
      const last = pinDrag.lastPlace;
      const holding = pinDrag;
      holding.releasing = true;
      deps.requestPick(pointOf(event), (ref) => {
        if (pinDrag !== holding) return;
        endPinDrag(placeOf(ref) ?? last);
      });
      return;
    }
    if (press === null || event.pointerId !== press.id) return;
    const ended = press;
    press = null;
    refresh();
    if (ended.multi || ended.button !== 0) return;
    const up = pointOf(event);
    if (!isClick(ended.start, up)) return;
    waiting = true;
    deps.requestPick(up, (ref) => {
      waiting = false;
      act(ref);
    });
  };

  const onCancel = (event: PointerEvent): void => {
    if (pinDrag !== null && event.pointerId === pinDrag.id) endPinDrag(null);
    if (press !== null && event.pointerId === press.id) press = null;
    refresh();
  };

  const unsubscribe = deps.onPick(onPick);
  element.addEventListener('pointerdown', onDown, { capture: true });
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerleave', onLeave);
  doc.addEventListener('pointerup', onUp);
  doc.addEventListener('pointercancel', onCancel);
  refresh();

  return {
    refresh,
    detach() {
      unsubscribe();
      element.removeEventListener('pointerdown', onDown, { capture: true });
      endPinDrag(null);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onCancel);
      clearHover();
      element.style.cursor = '';
    },
  };
}
