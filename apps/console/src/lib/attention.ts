import type { Incident, IncidentSeverity } from '@occ/contracts';
import { severityIcon } from '../ui/icons';
import type { Toast } from '../ui/toasts';
import { severityLabel, typeLabel } from './incidents';

/** Severities that announce a new incident with a toast; the others rely on the feed row. */
const TOASTED: readonly IncidentSeverity[] = ['critical', 'high'];

/**
 * The toast for an incident that just arrived live (frame 04), or `null` when its severity does not
 * warrant one. A critical toast is urgent: it stays until dismissed and is read out at once.
 * Keyed to the incident, so the reporter's own success toast and this one never both show.
 */
export function incidentToast(
  incident: Incident,
  zoneName: string | undefined,
  onView: () => void,
): Omit<Toast, 'id'> | null {
  if (!TOASTED.includes(incident.severity)) return null;
  return {
    key: incident.id,
    severity: incident.severity,
    icon: severityIcon(incident.severity),
    kicker: `New ${severityLabel(incident.severity).toLowerCase()} · ${typeLabel(incident.type)}`,
    title: incident.title,
    detail: [zoneName, incident.code, 'just now'].filter(Boolean).join(' · '),
    urgent: incident.severity === 'critical',
    action: { label: 'View incident', onAction: onView },
  };
}
