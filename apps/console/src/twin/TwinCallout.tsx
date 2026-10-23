import { type KeyboardEvent, type RefObject, useEffect, useMemo, useRef } from 'react';
import { useAsset, useModelParts } from '../api/queries';
import { readingIsStale } from '../lib/assets/assetInspector';
import { partRows } from '../lib/modelParts';
import { ageMs, staleAfterMs } from '../lib/telemetry/telemetryFreshness';
import { calloutOf } from '../lib/twinCallout';
import type { LeaderStart } from '../lib/twinLeader';
import { levelOf } from '../lib/twinLevel';
import { TWIN_VIEW_ID } from '../lib/twinSummary';
import { useAssetState, useServerNow } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { X } from '../ui/icons';
import styles from './TwinCallout.module.css';

/**
 * The card of the selected part and the line that joins it to the part (V2-15.10, frames 03, 08 and 17
 * `.tw-callout`): what the part is, what it reads, and whether that is live. Shown at **part level** only; the
 * inner component is the one that reads the asset, so a stage with no part selected subscribes to nothing.
 *
 * - **Its content** is `calloutOf` (`lib/twinCallout.ts`), built from what the inspector already holds for the same
 *   asset (`useAsset`, `useModelParts`, the telemetry store, the server clock; shared queries, no request of its own):
 *   the eyebrow "CT-01 · FanBlade", the part's label, its bound reading large with its unit, "Live" or its age when it
 *   is not live, and "Limit 85 °C" when a rule watches it. A boolean or an enum point reads in words ("Closed"). With
 *   the detail or the model's tree still on its way the part reads "—" under its node's name.
 * - **A named dialog that does not take focus** (ADR-0020 "Settled in V2-15.10"): `role="dialog"` named for the part,
 *   no `aria-modal`, no focus trap and no focus moved on open, because it opens from a click on a canvas beside a live
 *   scene and the 3D view is the stage's one tab stop. It comes after the view in the DOM, so Tab reaches Close. It is
 *   **not a live region**: the figure changes every second and nothing in it is announced.
 * - **Close and Escape inside the card close the card only** (`selectPart(null)`): the asset and its inspector stay,
 *   and focus goes back to the 3D view, as the breadcrumb's does. The inspector's own Escape step is V2-15.11's.
 * - **The leader** starts at the card's right edge, which the card measures when its box changes (a `ResizeObserver`,
 *   never per frame) and reports through `onStart` (`null` when it closes); the stage keeps it in a ref and
 *   `LeaderProjector` ends the line on the part. The SVG itself is `LeaderOverlay`, the stage's, always there and
 *   hidden while nothing is selected. The same for every role: the card reads no permission.
 */
export function TwinCallout({ onStart }: { onStart: (start: LeaderStart | null) => void }) {
  const partLevel = useConsole((state) => levelOf(state) === 'part');
  const assetCode = useConsole((state) => state.selectedAssetCode);
  const node = useConsole((state) => state.selectedPart);
  if (!partLevel || assetCode === null || node === null) return null;
  return <PartCallout assetCode={assetCode} node={node} onStart={onStart} />;
}

/**
 * The leader's SVG (V2-15.10): a line and a dot over the stage, `aria-hidden`, taking no pointer event, drawn hidden
 * until `LeaderProjector` writes them. The stage renders it before the card, so the card paints over its start; the
 * refs are the stage's, which hands the same two to the canvas's writer.
 */
export function LeaderOverlay({
  lineRef,
  dotRef,
}: {
  lineRef: RefObject<SVGLineElement | null>;
  dotRef: RefObject<SVGCircleElement | null>;
}) {
  return (
    <svg className={styles.leader} aria-hidden="true" focusable="false">
      <line ref={lineRef} className={styles.line} visibility="hidden" />
      <circle ref={dotRef} className={styles.dot} r="4" visibility="hidden" />
    </svg>
  );
}

/** Back to the 3D view after Close or Escape: the card that had focus is gone. */
const focusView = (): void => document.getElementById(TWIN_VIEW_ID)?.focus();

function closeCallout(): void {
  useConsole.getState().selectPart(null);
  focusView();
}

function PartCallout({
  assetCode,
  node,
  onStart,
}: {
  assetCode: string;
  node: string;
  onStart: (start: LeaderStart | null) => void;
}) {
  const { data: detail } = useAsset(assetCode);
  const { data: model } = useModelParts(detail?.class.modelUrl ?? null);
  const entry = useAssetState(assetCode);
  const serverNow = useServerNow();
  const card = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => (detail === undefined || !model ? undefined : partRows(model, detail.points)),
    [detail, model],
  );
  const callout = useMemo(() => {
    const row = rows?.find((candidate) => candidate.name === node);
    const key = row?.bind ?? null;
    const point =
      key === null ? undefined : detail?.points.find((candidate) => candidate.key === key);
    const rule =
      key === null ? null : (detail?.rules.find((candidate) => candidate.key === key) ?? null);
    // The freshest copy wins, as the Parts rows: frames are laid over the headline.
    const value = key === null ? undefined : (entry?.values[key] ?? entry?.headline[key]);
    return calloutOf({
      assetCode,
      node,
      row,
      point,
      rule,
      value,
      stale:
        detail !== undefined &&
        entry !== undefined &&
        readingIsStale(entry, staleAfterMs(detail.headline), serverNow),
      ageMs: entry === undefined || serverNow === null ? null : ageMs(entry.receivedAt, serverNow),
    });
  }, [assetCode, node, rows, detail, entry, serverNow]);

  // Where the leader starts: the card's right edge, measured when its box changes (a limit line arriving makes it
  // taller) and reported to the stage, which hands it to the canvas's writer and asks for a frame.
  useEffect(() => {
    const element = card.current;
    if (element === null) return;
    const measure = () =>
      onStart({
        x: element.offsetLeft + element.offsetWidth,
        y: element.offsetTop + element.offsetHeight / 2,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      onStart(null);
    };
  }, [onStart]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    closeCallout();
  };

  const { reading } = callout;
  return (
    <>
      <div
        ref={card}
        role="dialog"
        aria-label={callout.label}
        className={styles.card}
        onKeyDown={onKeyDown}
      >
        <div className={styles.head}>
          <div className={styles.titles}>
            <p className={styles.eyebrow}>{callout.eyebrow}</p>
            <p className={styles.name}>{callout.label}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label="Close part details"
            className={styles.close}
            onClick={closeCallout}
          />
        </div>
        <div className={styles.body}>
          <p className={styles.reading}>
            {reading.last && <span className={styles.secondary}>last </span>}
            <span className={styles.figure}>{reading.text}</span>
            {reading.unit !== null && <span className={styles.unit}> {reading.unit}</span>}
          </p>
          {callout.subline !== null && <p className={styles.subline}>{callout.subline}</p>}
          {callout.limit !== null && <p className={styles.limit}>{callout.limit}</p>}
        </div>
      </div>
    </>
  );
}
