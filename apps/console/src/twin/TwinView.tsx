import type { ReactNode } from 'react';
import { useIncidents, useSitePlan } from '../api/queries';
import { HEAT_DOMAIN, type HeatScene } from '../lib/twinHeat';
import { keyCommand } from '../lib/twinKeys';
import {
  activeIncidentCount,
  TWIN_VIEW_ID,
  TWIN_VIEW_KEYS,
  TWIN_VIEW_KEYS_ID,
  twinSummary,
} from '../lib/twinSummary';
import { useConsole } from '../store';
import { runKeyCommand } from './runKeyCommand';
import styles from './TwinView.module.css';

interface TwinViewProps {
  /** What the group stands for: the canvas and the zone labels, which assistive technology cannot read. */
  children: ReactNode;
  /** The heat overlay (V2-17.3), or `null` while it is not shown: the name then also says what the colours mean. */
  heat: HeatScene | null;
  /** The video wall (V2-21.6): the group is a name for assistive technology and nothing more: no tab stop, no keys. */
  wall?: boolean;
}

/**
 * The 3D view as assistive technology meets it (V2-12.12, ADR-0020): one focusable group, one tab stop,
 * named by a text summary of the site and its active incidents. The Assets tab and the inspector are the
 * accessible twin; the summary says so and the canvas inside is hidden (`TwinStage`), so a screen reader
 * reads the sentence once on focus and does not walk an opaque picture.
 *
 * - A `group`, not `role="application"` (it would switch off the screen reader's browse mode for the
 *   whole stage) and not an `img` (a second announcement beside the summary). `aria-roledescription`
 *   needs a role to hang on, which is what the group is for.
 * - The label is not a live region: it is read on focus, so a count that changes while the stage
 *   is idle does not interrupt anyone. New incidents are announced by the feed and the toasts.
 * - It wraps only the picture. The camera controls, the legend and the hint are siblings in the stage
 *   (`TwinStage`): they are real buttons with their own tab stops (V2-12.10), and inside a labelled
 *   group a screen reader would announce the group again as it enters.
 * - With the heat overlay shown the name also says what the colours mean and which buildings are faded because their
 *   sensor is silent (V2-17.3, `twinSummary`): the canvas is hidden, and the lists, the building card and the legend
 *   carry the numbers. The overlay is one object while nothing in it changes, so this wrapper does not render for a
 *   second that changed nothing.
 * - **The keys (V2-18.3)** are handled here, on the group, because it is the element that has focus: arrows orbit, tilt
 *   and (with Shift) pan, `+` and `-` zoom, `Home` resets and `Escape` goes up one level (`keyCommand`,
 *   `runKeyCommand`). A key that is handled is `preventDefault`ed (the page must not scroll on an arrow); any other is
 *   left alone, so `Tab`, `V`, `F`, `?`, `/` and `N` reach their own handlers, and an `Escape` with nothing to close
 *   (the campus) is not taken. They work only while the group has focus, so `Home` and the arrows keep V1's meaning in
 *   the lists, and they are not behind the single-key switch (active only on focus: WCAG 2.1.4). A hidden sentence
 *   names them (`aria-describedby`; a description may point at hidden content, and the name stays the summary).
 * - **A press on the picture focuses the group.** Nothing else would: the canvas library may stop the pointer event,
 *   so the capture phase is used, and `preventDefault()` is not called, so a drag is not affected. Without it a mouse
 *   user who orbited and then pressed an arrow would get nothing (V2-18.3, `unverified` in a browser).
 *
 * - **On a video wall** (`wall`, V2-21.6) there is no keyboard and no pointer to serve: the group keeps its role and its
 *   summary, and loses the tab stop, the key handler, the press-to-focus and the hidden list of keys.
 *
 * A wrapper of its own so the incident subscription re-renders only this component: `children` are
 * elements made by `TwinStage`, which keep their identity, so the canvas tree is not rendered again
 * at every incident event.
 */
export function TwinView({ children, heat, wall = false }: TwinViewProps) {
  const panTool = useConsole((s) => s.panTool);
  const { data: plan } = useSitePlan();
  const { data: incidents } = useIncidents();
  const summary = twinSummary({
    siteName: plan?.name,
    activeIncidents: incidents ? activeIncidentCount(incidents) : null,
    heat: heat === null ? null : { silentNames: heat.silentNames, domain: HEAT_DOMAIN },
  });

  if (wall) {
    return (
      <div
        id={TWIN_VIEW_ID}
        role="group"
        aria-roledescription="3D view"
        aria-label={summary}
        className={styles.view}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      id={TWIN_VIEW_ID}
      role="group"
      tabIndex={0}
      aria-roledescription="3D view"
      aria-label={summary}
      aria-describedby={TWIN_VIEW_KEYS_ID}
      data-tool={panTool ? 'pan' : undefined}
      className={styles.view}
      onKeyDown={(event) => {
        const command = keyCommand(event.nativeEvent);
        if (command !== null && runKeyCommand(command)) event.preventDefault();
      }}
      onPointerDownCapture={(event) => {
        if (document.activeElement !== event.currentTarget) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
    >
      {children}
      <p id={TWIN_VIEW_KEYS_ID} hidden>
        {TWIN_VIEW_KEYS}
      </p>
    </div>
  );
}
