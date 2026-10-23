import type { Asset, Camera, Incident, IncidentSeverity } from '@occ/contracts';
import { assetStates, openIncidentOf } from '../lib/assets';
import { freshnessText } from '../lib/assetInspector';
import { stateText } from '../lib/assetList';
import { formatAge, severityLabel, statusLabel } from '../lib/incidents/incidents';
import { formatReading } from '../lib/readings';
import { ageMs as readingAgeMs, isStale, staleAfterMs } from '../lib/telemetryFreshness';
import { useNow } from '../lib/useNow';
import { useAssetState, useServerNow } from '../realtime/telemetryStore';
import { Icon } from '../ui/Icon';
import {
  assetStateIcon,
  cameraIcon,
  incidentTypeIcon,
  severityIcon,
  statusIcon,
} from '../ui/icons';
import styles from './Tips.module.css';

/*
 * The bodies of the console's hover tooltips, shared by the 2D map (`MapTooltip`) and the 3D view
 * (`twin/TwinTooltip`, V2-15.5). They are the contents only: each tooltip owns where it stands, and the
 * surface they sit on is `tipSurface` (`Tips.module.css`), because the bodies' rules hang off it.
 * They read the clock and the telemetry store themselves, so a tooltip re-renders only the body that is open.
 */

export function IncidentTip({ incident, zone }: { incident: Incident; zone?: string }) {
  const now = useNow();
  return (
    <>
      <p className={styles.title}>
        <Icon glyph={incidentTypeIcon(incident.type)} size={16} className={styles.glyph} />
        <span className={styles.titleText}>{incident.title}</span>
      </p>
      <p className={styles.line} data-severity={incident.severity}>
        <Icon glyph={severityIcon(incident.severity)} size={16} className={styles.severity} />
        {severityLabel(incident.severity)}
        <span className={styles.status}>
          <Icon glyph={statusIcon(incident.status)} size={16} />
          {statusLabel(incident.status)}
        </span>
      </p>
      <p>
        {[incident.code, zone, formatAge(incident.reportedAt, now)].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}

export function CameraTip({ camera, zone }: { camera: Camera; zone?: string }) {
  return (
    <>
      <p className={styles.title}>
        <Icon
          glyph={cameraIcon(camera.online)}
          size={16}
          className={camera.online ? styles.glyph : styles.offline}
        />
        <span className={styles.titleText}>{camera.name}</span>
      </p>
      <p>
        {[camera.code, zone, camera.online ? undefined : 'Offline'].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}

/** A cluster of incidents on the 2D map: how many, and the worst. */
export function ClusterTip({ count, severity }: { count: number; severity: IncidentSeverity }) {
  return (
    <>
      <p className={styles.title}>{count} incidents</p>
      <p className={styles.line} data-severity={severity}>
        <Icon glyph={severityIcon(severity)} size={16} className={styles.severity} />
        Highest: {severityLabel(severity)}
      </p>
      <p>Click to zoom in</p>
    </>
  );
}

/**
 * Frame 14's `.tw-tip`: name and code, the state word with its glyph (the list's wording), the two
 * headline readings from the overview (no watch: the tooltip never asks for more than the console
 * already holds), how old the asset's latest reading is, and where a click leads.
 *
 * The age is the asset's, not each reading's: a frame carries changed keys only, so a steady
 * reading's own age would read "old" on a healthy device (V2-08.3, and the inspector's rule). It
 * is the one component here that reads the clock, so only an open asset tooltip re-renders each
 * second.
 *
 * `foot` replaces the last line. The map leaves it out (its foot names the zone); the 3D view says the
 * place line, or that the asset is drawn as a box (V2-15.1, frame 15).
 */
export function AssetTip({
  asset,
  incidents,
  zone,
  foot,
}: {
  asset: Asset;
  incidents: readonly Incident[];
  zone?: string;
  foot?: string;
}) {
  const entry = useAssetState(asset.code);
  const now = useServerNow();

  const state =
    assetStates([asset], incidents, entry ? { [asset.code]: entry } : {}, now).get(asset.code) ??
    'unknown';
  const incident = state === 'fault' ? openIncidentOf(asset, incidents) : undefined;
  const age = entry !== undefined && now !== null ? readingAgeMs(entry.receivedAt, now) : null;
  // Offline or past its threshold: the values are the last known, and the age is said as such.
  const stale =
    entry !== undefined &&
    (!entry.online ||
      (now !== null && isStale(entry.receivedAt, staleAfterMs(asset.headline), now)));
  const word = stateText(state, { ageMs: stale ? age : null, incidentCode: incident?.code });
  const glyph =
    state === 'fault'
      ? incident && severityIcon(incident.severity)
      : state === 'unknown'
        ? undefined
        : assetStateIcon(state);
  const readings = asset.headline.slice(0, 2).map((point) => {
    const value = entry?.values[point.key] ?? entry?.headline[point.key];
    return {
      key: point.key,
      label: point.label,
      text: value === undefined ? '—' : formatReading(point, value),
    };
  });
  const freshness = freshnessText(age, stale);

  return (
    <>
      <p className={styles.assetHead}>
        <span className={styles.titleText}>{asset.name}</span>
        <span className={styles.assetCode}>{asset.code}</span>
      </p>
      {word !== null && (
        <p className={styles.line} data-severity={incident?.severity}>
          {glyph && <Icon glyph={glyph} size={16} className={styles.severity} />}
          {word}
        </p>
      )}
      {readings.length > 0 && (
        <dl className={styles.readings}>
          {readings.map((reading) => (
            <div key={reading.key} className={styles.reading}>
              <dt>{reading.label}</dt>
              <dd data-stale={stale}>{reading.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {freshness !== null && <p className={styles.age}>{freshness}</p>}
      <p className={styles.foot}>
        {foot ?? ['Click to inspect', zone].filter(Boolean).join(' · ')}
      </p>
    </>
  );
}
