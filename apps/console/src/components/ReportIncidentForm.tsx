import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentType,
} from '@occ/contracts';
import { type FormEvent, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED } from '../api/client';
import { useReportIncident, useZones } from '../api/queries';
import { newIdempotencyKey } from '../lib/idempotency';
import { typeLabel } from '../lib/incidents';
import { useCloseOnEscape } from '../lib/useCloseOnEscape';
import { useConsole } from '../store';

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;
const DEFAULT_SEVERITY: IncidentSeverity = 'medium';
/** The API's 422 for this form: the key was used for a report with other details. */
const REPORT_ALREADY_SENT =
  'This report was already sent with different details. Check the incident feed before reporting it again.';

/** The API's message, except for the statuses an operator needs explained in their own terms. */
function reportErrorMessage(error: Error): string {
  if (!(error instanceof ApiRequestError)) return error.message;
  if (error.status === 422) return REPORT_ALREADY_SENT;
  if (error.status === 403) return NO_LONGER_ALLOWED;
  return error.message;
}

/** Operator-reported incident. Limits mirror the API's validation rules. */
export function ReportIncidentForm() {
  const { data: zones = [] } = useZones();
  const report = useReportIncident();
  const select = useConsole((s) => s.select);
  const closeReport = useConsole((s) => s.closeReport);

  const [type, setType] = useState<IncidentType | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity>(DEFAULT_SEVERITY);
  const [zoneId, setZoneId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // One key per opened form, reused by every retry. Not renewed when a field changes: if a failed
  // attempt actually reached the API, an edited retry must get a 422, not create a duplicate.
  const [idempotencyKey] = useState(newIdempotencyKey);

  const hasDraft =
    type !== '' ||
    severity !== DEFAULT_SEVERITY ||
    zoneId !== '' ||
    title.trim() !== '' ||
    description.trim() !== '';
  useCloseOnEscape(closeReport, hasDraft);

  const ready = type !== '' && zoneId !== '' && title.trim() !== '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || report.isPending) return;
    report.mutate(
      {
        request: {
          type,
          severity,
          zoneId,
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
        idempotencyKey,
      },
      { onSuccess: (incident) => select(incident.id) },
    );
  };

  return (
    <aside id="report-incident-panel" className="detail" aria-label="Report an incident">
      <form className="report-form" onSubmit={submit} noValidate>
        <div className="detail-toprow">
          <h2 className="detail-title">Report an incident</h2>
        </div>

        <label className="field">
          <span className="field-label">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as IncidentType)} required>
            <option value="" disabled>
              Choose a type
            </option>
            {INCIDENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {typeLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field">
          <legend className="field-label">Severity</legend>
          <div className="segmented">
            {INCIDENT_SEVERITIES.map((value) => (
              <label key={value} data-severity={value}>
                <input
                  type="radio"
                  name="severity"
                  value={value}
                  checked={severity === value}
                  onChange={() => setSeverity(value)}
                />
                <span>{value[0]!.toUpperCase() + value.slice(1)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span className="field-label">Location</span>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
            <option value="" disabled>
              Choose a zone
            </option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder="What is happening, in a few words"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Details (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            placeholder="Who reported it, what they saw, anything the responder should know"
          />
        </label>

        {report.error && (
          <p className="form-error" role="alert">
            {reportErrorMessage(report.error)}
          </p>
        )}

        <div className="action-buttons">
          <button
            type="submit"
            className="button button-primary"
            disabled={!ready || report.isPending}
          >
            {report.isPending ? 'Reporting…' : 'Report incident'}
          </button>
          <button type="button" className="button" onClick={closeReport}>
            Cancel
          </button>
        </div>
      </form>
    </aside>
  );
}
