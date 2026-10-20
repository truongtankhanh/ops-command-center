import type { ReactNode } from 'react';
import { useIncidents, useSitePlan } from '../api/queries';
import { HEAT_DOMAIN, type HeatScene } from '../lib/twinHeat';
import { activeIncidentCount, TWIN_VIEW_ID, twinSummary } from '../lib/twinSummary';
import styles from './TwinView.module.css';

interface TwinViewProps {
  /** What the group stands for: the canvas and the zone labels, which assistive technology cannot read. */
  children: ReactNode;
  /** The heat overlay (V2-17.3), or `null` while it is not shown: the name then also says what the colours mean. */
  heat: HeatScene | null;
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
 * - The keys that will operate the camera and a line that names them (`aria-describedby`) arrive with
 *   V2-18; there is nothing to describe yet.
 *
 * A wrapper of its own so the incident subscription re-renders only this component: `children` are
 * elements made by `TwinStage`, which keep their identity, so the canvas tree is not rendered again
 * at every incident event.
 */
export function TwinView({ children, heat }: TwinViewProps) {
  const { data: plan } = useSitePlan();
  const { data: incidents } = useIncidents();
  const summary = twinSummary({
    siteName: plan?.name,
    activeIncidents: incidents ? activeIncidentCount(incidents) : null,
    heat: heat === null ? null : { silentNames: heat.silentNames, domain: HEAT_DOMAIN },
  });

  return (
    <div
      id={TWIN_VIEW_ID}
      role="group"
      tabIndex={0}
      aria-roledescription="3D view"
      aria-label={summary}
      className={styles.view}
    >
      {children}
    </div>
  );
}
