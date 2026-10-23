import type { Asset, Incident, IncidentDetail, IncidentSeverity } from '@occ/contracts';
import { openIncidentOf } from '../lib/assets/assets';
import { evidenceOfTimeline } from '../lib/telemetry/telemetryEvidence';
import { isStale, serverNow, staleAfterMs } from '../lib/telemetry/telemetryFreshness';
import type { Binding } from '../lib/twinBindings';
import type { TelemetryClient } from './telemetryClient';
import type { TargetSlot } from './telemetryProtocol';

/*
 * What the render loop reads of telemetry without a React render (V2-14.5, ADR-0020 § State "readings
 * never enter React state"): the latest targets buffer of the current layout, and per asset a few flags
 * the worker cannot decide because they need the catalogue, the incidents and the server clock (V2-08.4).
 * Not a React module and not `three`: it reads the telemetry client, the query cache through the getters it
 * is given, and a timer, and it touches no store. V2-14.8 applies what it holds to the nodes; until then
 * nothing consumes it.
 *
 * Two clocks must not mix. An age is judged on the server's clock, rebuilt from the client's anchor and
 * `performance.now()` (as `useServerNow` does), never on `Date.now()` or a frame's time.
 *
 * Frame demand: conditional. A frame is asked for only when a buffer of the current layout arrived (the engine posts
 * one only when a slot changed), a flag or the layout changed, or the tab came back into view; a quiet tick asks for
 * none. While the tab is hidden the feed keeps its state current (buffers, flags, the layout) but asks for nothing and
 * its one-second tick does no work: on return one pass catches the flags up and one frame is asked for (V2-19.2). The
 * socket and the worker are not the feed's and keep running.
 */

/** What the scene needs to know of an asset besides its numbers. */
export interface AssetFlags {
  /** No data, or its latest reading is older than the asset's threshold: the list's "No data" (V2-08.1). */
  readonly stale: boolean;
  /** `false` once the device's last will fired, and for an asset nothing was received about. */
  readonly online: boolean;
  /** The severity of the asset's open incident: the most severe, then the newest (`openIncidentOf`). */
  readonly alarm: IncidentSeverity | null;
  /** The point its rule watches, when the incident's cached detail says; `null` otherwise. */
  readonly ruleKey: string | null;
}

export interface TwinFeedReader {
  /**
   * The current value of every slot of the layout, `NaN` for none yet. It is the client's own buffer, not a
   * copy: the render loop reads it and never writes to it.
   */
  readonly targets: Float32Array;
  /**
   * The id of the layout `targets` and `slotOf` are for, `0` while none was sent. It changes whenever a new
   * layout is sent and not otherwise, so a reader that resolves its slots once can tell when to do it again
   * (`slotOf` builds a key string per call, which a render loop must not do every frame; V2-14.8).
   */
  readonly layout: number;
  /** The index of an asset's key in `targets`, `-1` when the pair is not in the layout. */
  slotOf(assetCode: string, key: string): number;
  /** An asset's flags; an unknown code reads as no data. */
  flags(assetCode: string): AssetFlags;
}

export interface TwinFeedOptions {
  client: TelemetryClient;
  getAssets: () => readonly Asset[];
  getIncidents: () => readonly Incident[];
  /** The incident's detail when something already fetched it. The feed makes no request itself. */
  getIncidentDetail: (id: string) => IncidentDetail | undefined;
  /** Called once when a buffer arrived or a flag or the layout changed, so a demand-mode canvas draws a frame. */
  invalidate: () => void;
}

export interface TwinFeed {
  /** One stable object; nothing is allocated per call, because it is read every frame. */
  read(): TwinFeedReader;
  /**
   * What a class's model binds (V2-14.2), told by whoever loads the model (V2-14.7). The layout is the bound
   * keys of every asset's class; until a class is told, it has none.
   */
  setBindings(classCode: string, bindings: readonly Binding[]): void;
  /** Rebuilds the layout and the flags now, for a caller that knows the assets or the incidents changed. */
  refresh(): void;
  /**
   * Idempotent. Stops the timer and the listeners (the visibility one included) and, if a layout was sent, sends an
   * empty one so the worker stops posting buffers nobody reads. Afterwards `read()` still answers with what it held,
   * and nothing is invalidated.
   */
  dispose(): void;
}

/** Staleness is a function of the clock, so it is looked at on a timer as well as on a message. */
const FLAGS_TICK_MS = 1000;

/** An unknown asset, or one that is gone from the list: nothing is known of it, as the list says. */
const NO_FLAGS: AssetFlags = Object.freeze({
  stale: true,
  online: false,
  alarm: null,
  ruleKey: null,
});

interface BoundKey {
  key: string;
  enumValues: string[] | null;
}

const slotKey = (assetCode: string, key: string): string => `${assetCode}|${key}`;

const sameEnumValues = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.length === b.length && a.every((value, i) => value === b[i]));

const sameSlots = (a: readonly TargetSlot[], b: readonly TargetSlot[]): boolean =>
  a.length === b.length &&
  a.every((slot, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      slot.assetCode === other.assetCode &&
      slot.key === other.key &&
      sameEnumValues(slot.enumValues, other.enumValues)
    );
  });

const sameFlags = (a: AssetFlags, b: AssetFlags): boolean =>
  a.stale === b.stale && a.online === b.online && a.alarm === b.alarm && a.ruleKey === b.ruleKey;

export function createTwinFeed({
  client,
  getAssets,
  getIncidents,
  getIncidentDetail,
  invalidate,
}: TwinFeedOptions): TwinFeed {
  const bound = new Map<string, BoundKey[]>();
  let slots: readonly TargetSlot[] = [];
  /** The id `client.setLayout` gave the current layout; 0 while none has been sent. */
  let layoutId = 0;
  let index = new Map<string, number>();
  // Typed wide: the client's buffer is a `Float32Array<ArrayBufferLike>`, an array made here an `ArrayBuffer` one.
  let latest: Float32Array = new Float32Array(0);
  let flags = new Map<string, AssetFlags>();
  let disposed = false;

  /** Whether the tab is out of view. Outside a browser there is no `document`: a feed there is always in view. */
  const tabHidden = (): boolean => typeof document !== 'undefined' && document.hidden;

  /** Asks the canvas for a frame, unless the tab is hidden: nothing is queued for the return (`onVisible` asks once). */
  const askForFrame = (): void => {
    if (!tabHidden()) invalidate();
  };

  const reader: TwinFeedReader = {
    get targets() {
      return latest;
    },
    get layout() {
      return layoutId;
    },
    slotOf: (assetCode, key) => index.get(slotKey(assetCode, key)) ?? -1,
    flags: (assetCode) => flags.get(assetCode) ?? NO_FLAGS,
  };

  /** Every asset, in order, with the bound keys of its class. */
  function buildSlots(): TargetSlot[] {
    const next: TargetSlot[] = [];
    for (const asset of getAssets()) {
      for (const { key, enumValues } of bound.get(asset.class.code) ?? []) {
        next.push({
          assetCode: asset.code,
          key,
          enumValues: enumValues === null ? null : [...enumValues],
        });
      }
    }
    return next;
  }

  /**
   * Sends a new layout when the slots differ: each one resets what the worker last posted, so it is not
   * sent for a rebuild that came out the same. With nothing to follow and nothing sent, the worker is left
   * alone; with nothing to follow after something was, an empty layout makes it stop posting.
   */
  function updateLayout(): boolean {
    const next = buildSlots();
    if (sameSlots(next, slots)) return false;
    if (next.length === 0 && layoutId === 0) return false;
    slots = next;
    index = new Map(next.map((slot, position) => [slotKey(slot.assetCode, slot.key), position]));
    latest = new Float32Array(next.length).fill(Number.NaN);
    layoutId = client.setLayout(next);
    return true;
  }

  /**
   * The flags of every asset. A stored object is kept while its fields are the same, so a reader can compare
   * references. Stale follows the console's own rule on the server's clock; an absent entry is "No data", as in
   * the list, and a fault is never hidden by it (`alarm` is independent of `stale`).
   */
  function updateFlags(): boolean {
    const view = client.getView();
    const now = serverNow(view.state.serverClock, performance.now());
    const incidents = getIncidents();
    const next = new Map<string, AssetFlags>();
    let changed = false;
    for (const asset of getAssets()) {
      const entry = view.state.assets[asset.code];
      const incident = openIncidentOf(asset, incidents);
      const computed: AssetFlags = {
        online: entry?.online ?? false,
        // No clock yet cannot judge, and "cannot judge" is not stale (as `assetStates`).
        stale:
          entry === undefined ||
          (now !== null && isStale(entry.receivedAt, staleAfterMs(asset.headline), now)),
        alarm: incident?.severity ?? null,
        ruleKey:
          incident === undefined
            ? null
            : (evidenceOfTimeline(getIncidentDetail(incident.id)?.timeline ?? [])?.key ?? null),
      };
      const previous = flags.get(asset.code);
      const kept = previous !== undefined && sameFlags(previous, computed) ? previous : computed;
      if (kept !== previous) changed = true;
      next.set(asset.code, kept);
    }
    // An asset that left the list changes the map without changing any stored object.
    if (next.size !== flags.size) changed = true;
    flags = next;
    return changed;
  }

  /** One pass over both; `true` when anything a reader holds is different now. */
  function step(): boolean {
    const layoutChanged = updateLayout();
    const flagsChanged = updateFlags();
    return layoutChanged || flagsChanged;
  }

  function refresh() {
    if (disposed) return;
    if (step()) askForFrame();
  }

  // Creating the feed is the first pass; nothing has been drawn that it could invalidate.
  step();

  const stopView = client.subscribe(refresh);
  const stopTargets = client.onTargets((targets) => {
    // The client already drops a buffer of an earlier layout; this guards the feed's own id as well.
    if (disposed || layoutId === 0 || targets.layoutId !== layoutId) return;
    latest = targets.buffer;
    askForFrame();
  });
  // Staleness is a function of the clock, but nobody sees it in a hidden tab: the tick waits, and `onVisible` catches up.
  const timer = setInterval(() => {
    if (!tabHidden()) refresh();
  }, FLAGS_TICK_MS);
  // Back in view: one pass brings the flags up to the clock (the age is judged on `performance.now()`, so the catch-up
  // is exact), and one frame is asked for whether or not anything changed, so the picture is current at once.
  const onVisible = (): void => {
    if (disposed || tabHidden()) return;
    step();
    invalidate();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

  return {
    read: () => reader,

    setBindings(classCode, bindings) {
      const keys = new Map<string, BoundKey>();
      for (const { key, point } of bindings) {
        if (keys.has(key)) continue;
        keys.set(key, {
          key,
          enumValues: point.enumValues === null ? null : [...point.enumValues],
        });
      }
      bound.set(classCode, [...keys.values()]);
      refresh();
    },

    refresh,

    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
      stopView();
      stopTargets();
      // The worker keeps posting buffers for the last layout it was given; with no reader left, an empty one stops it.
      if (layoutId !== 0 && slots.length > 0) client.setLayout([]);
    },
  };
}
