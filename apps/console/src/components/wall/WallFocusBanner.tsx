import { useAsset, useAssets, useIncident, useIncidents, useZones } from '../../api/queries';
import { formatReading } from '../../lib/readings';
import { describeEvidence, evidenceOfTimeline } from '../../lib/telemetryEvidence';
import { Icon } from '../../ui/Icon';
import { severityIcon } from '../../ui/icons';
import styles from './WallFocusBanner.module.css';

interface WallFocusBannerProps {
  /** The incident the camera is on, or `null` on the campus view (`useWallFocus`). */
  incidentId: string | null;
  /** Whole seconds until the camera goes home. */
  secondsLeft: number;
  /** The camera has been to an incident and is back: said once. */
  returned: boolean;
}

/**
 * The wall's focus banner (V2-21.8, frame 18 `.wall-focus`), top centre over the stage while the camera is on an
 * incident: the severity glyph, the title, "INC-… · zone · 92 °C, limit 85 °C · not acknowledged" and "Campus view in N s".
 *
 * - **Said once, not every second.** The live region is a hidden `role="status"` that is always mounted, because a
 *   region that appears already holding its text is announced by some screen readers and not by others. It holds the
 *   arrival from the list's data only (code, zone, title), which never changes while the focus lasts, so the reading
 *   that arrives later does not repeat it, and "Back to the campus view" when the camera returns. The drawn card has no
 *   live role and the countdown sits in no live region, so the seconds are never read out.
 * - **The reading** comes from the incident's evidence (the first `reported` note, as the sheet's "Why it was raised"
 *   reads it) and the asset's point for its unit. An incident without it (an operator's, or one whose asset detail has
 *   not arrived) has a shorter line; nothing is invented.
 * - Only an open, not yet acknowledged incident is ever held (`lib/wallFocus.ts`), so the status is a fixed phrase.
 */
export function WallFocusBanner({ incidentId, secondsLeft, returned }: WallFocusBannerProps) {
  const { data: incidents } = useIncidents();
  const { data: zones } = useZones();
  const incident = incidentId === null ? undefined : incidents?.find((i) => i.id === incidentId);
  const zone = zones?.find((z) => z.id === incident?.zoneId)?.name;
  const where = zone === undefined ? '' : `, ${zone}`;

  const announcement =
    incident !== undefined
      ? `Critical incident ${incident.code}${where}: ${incident.title}`
      : returned
        ? 'Back to the campus view'
        : '';

  return (
    <>
      <p role="status" className={styles.hidden}>
        {announcement}
      </p>
      {incident !== undefined && (
        <div className={styles.banner}>
          <span className={styles.glyph}>
            <Icon glyph={severityIcon(incident.severity)} size={22} />
          </span>
          <div className={styles.text}>
            <strong className={styles.title}>{incident.title}</strong>
            <small className={styles.detail}>
              <FocusDetail incidentId={incident.id} code={incident.code} zone={zone} />
            </small>
          </div>
          <div className={styles.return}>
            <span>Campus view in</span>
            <b>{secondsLeft} s</b>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * "INC-000107 · Data Center roof · 92 °C, limit 85 °C · not acknowledged". A component of its own, so the incident's
 * timeline and the asset are asked for only while a banner shows, and a late answer re-renders the line, not the card.
 */
function FocusDetail({
  incidentId,
  code,
  zone,
}: {
  incidentId: string;
  code: string;
  zone: string | undefined;
}) {
  const { data: detail } = useIncident(incidentId);
  const { data: assets } = useAssets();
  const asset = assets?.find((candidate) => candidate.id === detail?.assetId);
  const { data: assetDetail } = useAsset(asset?.code ?? null);

  const evidence = detail === undefined ? null : evidenceOfTimeline(detail.timeline);
  const point = assetDetail?.points.find((candidate) => candidate.key === evidence?.key);
  const reading =
    evidence !== null && point !== undefined
      ? `${describeEvidence(evidence, null, point).reading}, limit ${formatReading(point, evidence.limit)}`
      : null;

  return <>{[code, zone, reading, 'not acknowledged'].filter(Boolean).join(' · ')}</>;
}
