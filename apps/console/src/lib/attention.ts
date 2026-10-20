import type { Asset, Incident, IncidentSeverity, Zone } from '@occ/contracts';
import { severityIcon } from '../ui/icons';
import type { Toast } from '../ui/toasts';
import { placeLabel } from './assets';
import { severityLabel, typeLabel } from './incidents';

/** Severities that announce a new incident with a toast; the others rely on the feed row. */
const TOASTED: readonly IncidentSeverity[] = ['critical', 'high'];

/**
 * What the toast can say beyond the incident itself. Everything is optional: the live event is
 * announced at once with whatever is cached, and the reading is added when the incident's detail
 * arrives (V2-11.4), so each part may be missing.
 */
export interface IncidentToastContext {
  zone?: Pick<Zone, 'name' | 'kind' | 'heightM'>;
  /** The asset a telemetry rule raised the incident on, from the cached catalogue. */
  asset?: Pick<Asset, 'code' | 'elevationM'>;
  /** The reading that breached the rule ("92 °C for 60 s, limit 85 °C"), once it is known. */
  evidence?: string;
}

/**
 * The toast for an incident that just arrived live (frame 04), or `null` when its severity does not
 * warrant one. A critical toast is urgent: it stays until dismissed and is read out at once.
 * Keyed to the incident, so the reporter's own success toast and this one never both show.
 *
 * An incident a telemetry rule raised says so, and says where and what instead of who and when
 * (frame 04): "Critical · raised by telemetry rule", "CT-01 · Data Center · roof · 92 °C for 60 s,
 * limit 85 °C". It carries no "just now", which the added reading would make stale. Without the
 * asset (the catalogue is not loaded) it names the zone and the incident, as every toast does.
 *
 * Its actions depend on the view the caller says it is in (V2-16.5). With `onFly`, the 3D view: "Fly to" is the
 * action (select the incident, then fly to its beacon) and "Open incident" the secondary one (`onView`: select and
 * nothing else), for every role, because both only read. Without it, the 2D view: the single "View incident"
 * (`onView`), as it has always been. This function knows nothing of the view or the camera: the caller decides.
 */
export function incidentToast(
  incident: Incident,
  context: IncidentToastContext,
  onView: () => void,
  onFly?: () => void,
): Omit<Toast, 'id'> | null {
  if (!TOASTED.includes(incident.severity)) return null;
  const telemetry = incident.source === 'telemetry';
  return {
    key: incident.id,
    severity: incident.severity,
    icon: severityIcon(incident.severity),
    kicker: telemetry
      ? `${severityLabel(incident.severity)} · raised by telemetry rule`
      : `New ${severityLabel(incident.severity).toLowerCase()} · ${typeLabel(incident.type)}`,
    title: incident.title,
    detail: telemetry
      ? telemetryDetail(incident, context)
      : [context.zone?.name, incident.code, 'just now'].filter(Boolean).join(' · '),
    urgent: incident.severity === 'critical',
    ...(onFly
      ? {
          action: { label: 'Fly to', onAction: onFly },
          secondaryAction: { label: 'Open incident', onAction: onView },
        }
      : { action: { label: 'View incident', onAction: onView } }),
  };
}

function telemetryDetail(incident: Incident, { zone, asset, evidence }: IncidentToastContext) {
  const where = asset ? [asset.code, placeLabel(asset, zone)] : [zone?.name, incident.code];
  return [...where, evidence].filter(Boolean).join(' · ');
}
