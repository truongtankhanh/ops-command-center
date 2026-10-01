import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentType,
} from '@occ/contracts';
import { type FormEvent, useEffect, useState } from 'react';
import { useReportIncident, useZones } from '../api/queries';
import { typeLabel } from '../lib/incidents';
import { useConsole } from '../store';

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;

/** Operator-reported incident. Limits mirror the API's validation rules. */
export function ReportIncidentForm() {
  const { data: zones = [] } = useZones();
  const report = useReportIncident();
  const select = useConsole((s) => s.select);
  const closeReport = useConsole((s) => s.closeReport);

  const [type, setType] = useState<IncidentType | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [zoneId, setZoneId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeReport();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeReport]);

  const ready = type !== '' && zoneId !== '' && title.trim() !== '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || report.isPending) return;
    report.mutate(
      {
        type,
        severity,
        zoneId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
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
            {report.error.message}
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
