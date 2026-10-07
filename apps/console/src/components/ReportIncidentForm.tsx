import {
  INCIDENT_SEVERITIES,
  INCIDENT_TYPES,
  type IncidentSeverity,
  type IncidentType,
} from '@occ/contracts';
import { type FormEvent, useCallback, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED } from '../api/client';
import { useReportIncident, useZones } from '../api/queries';
import { newIdempotencyKey } from '../lib/idempotency';
import { severityLabel, typeLabel } from '../lib/incidents';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Field, Select, Textarea, TextInput } from '../ui/Field';
import { Hint } from '../ui/Hint';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Sheet } from '../ui/Sheet';
import styles from './ReportIncidentForm.module.css';

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;
const DEFAULT_SEVERITY: IncidentSeverity = 'medium';
const SEVERITY_OPTIONS = INCIDENT_SEVERITIES.map((value) => ({
  value,
  label: severityLabel(value),
  severity: value,
}));
/** Shown under the actions while a draft exists, and announced by the sheet when Escape is ignored. */
const DRAFT_KEPT = 'Esc keeps your draft. Cancel discards it.';
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

  // Set when Escape was ignored to keep the draft; forgotten once the draft is gone.
  const [kept, setKept] = useState(false);
  const [hadDraft, setHadDraft] = useState(hasDraft);
  if (hasDraft !== hadDraft) {
    setHadDraft(hasDraft);
    if (!hasDraft) setKept(false);
  }
  const keepDraft = useCallback(() => setKept(true), []);

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
    <Sheet
      id="report-incident-panel"
      label="Report an incident"
      onClose={closeReport}
      keepOpen={hasDraft}
      keptMessage={DRAFT_KEPT}
      onEscapeKept={keepDraft}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.toprow}>
          <h2 className={styles.title}>Report an incident</h2>
        </div>

        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as IncidentType)} required>
            <option value="" disabled>
              Choose a type
            </option>
            {INCIDENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {typeLabel(value)}
              </option>
            ))}
          </Select>
        </Field>

        <SegmentedControl
          legend="Severity"
          name="severity"
          options={SEVERITY_OPTIONS}
          value={severity}
          onChange={setSeverity}
        />

        <Field label="Location">
          <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)} required>
            <option value="" disabled>
              Choose a zone
            </option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title">
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder="What is happening, in a few words"
            required
          />
        </Field>

        <Field label="Details (optional)">
          <Textarea
            className={styles.details}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            placeholder="Who reported it, what they saw, anything the responder should know"
          />
        </Field>

        {report.error && (
          <p className={styles.error} role="alert">
            {reportErrorMessage(report.error)}
          </p>
        )}

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            className={styles.grow}
            loading={report.isPending}
            disabled={!ready}
          >
            {report.isPending ? 'Reporting…' : 'Report incident'}
          </Button>
          <Button
            variant="ghost"
            className={styles.grow}
            // Escape cancels only while there is nothing to lose; the hint below says so then.
            shortcut={hasDraft ? undefined : 'Esc'}
            onClick={closeReport}
          >
            Cancel
          </Button>
        </div>
        {hasDraft && <Hint tone={kept ? 'warning' : 'info'}>{DRAFT_KEPT}</Hint>}
      </form>
    </Sheet>
  );
}
