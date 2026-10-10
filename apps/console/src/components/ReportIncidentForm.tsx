import {
  categoryOf,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_TYPE_DEFAULT_SEVERITY,
  type IncidentCategory,
  type IncidentSeverity,
  type IncidentType,
  type LngLat,
  ROLE_CATEGORY_SCOPE,
  type Zone,
} from '@occ/contracts';
import { type FormEvent, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED, TOO_MANY_REQUESTS } from '../api/client';
import { useReportIncident, useZones } from '../api/queries';
import { usePermissionFor } from '../auth/usePermission';
import { formatLatLng } from '../lib/geo';
import { newIdempotencyKey } from '../lib/idempotency';
import {
  categoryLabel,
  severityLabel,
  typeLabel,
  typeLabelInSentence,
  typesInCategory,
  typesLikelyIn,
} from '../lib/incidents';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Field, Select, Textarea, TextInput } from '../ui/Field';
import { Hint, type HintTone } from '../ui/Hint';
import { categoryIcon, incidentTypeIcon, MapPin, severityIcon, X } from '../ui/icons';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Sheet } from '../ui/Sheet';
import { showToast } from '../ui/toasts';
import styles from './ReportIncidentForm.module.css';

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;
/** Until a type suggests its own (`INCIDENT_TYPE_DEFAULT_SEVERITY`). */
const DEFAULT_SEVERITY: IncidentSeverity = 'medium';
/** Step 1 (frame 09): a category first, because a grid of all 24 types is too long to scan. */
const CATEGORY_OPTIONS = INCIDENT_CATEGORIES.map((value) => ({
  value,
  label: categoryLabel(value),
  icon: categoryIcon(value),
}));
const SEVERITY_OPTIONS = INCIDENT_SEVERITIES.map((value) => ({
  value,
  label: severityLabel(value),
  severity: value,
  icon: severityIcon(value),
}));
/** Shown under the actions while a draft exists, and announced by the sheet when Escape is ignored. */
const DRAFT_KEPT = 'Esc keeps your draft. Cancel discards it.';
/** The API's 422 for this form: the key was used for a report with other details. */
const REPORT_ALREADY_SENT =
  'This report was already sent with different details. Check the incident feed before reporting it again.';
/** Shown on a required field once a submit found it empty. */
const MISSING = {
  category: 'Choose a category.',
  type: 'Choose a type.',
  zone: 'Choose a location.',
  title: 'Enter a title.',
} as const;
/**
 * The start of the API's 400 for a pin outside its zone ("position is outside zone BLD-LIB"). The
 * API sends no error code, and a failed validation is a 400 too, so the message is matched.
 */
const OUTSIDE_ZONE_PREFIX = 'position is outside zone';

/** Whether `category` goes to the technicians' queue: read from the scope the API enforces. */
function inTechnicianQueue(category: IncidentCategory): boolean {
  const scope = ROLE_CATEGORY_SCOPE.technician;
  return scope === 'all' || scope.includes(category);
}

/** The line under the severity, once a type is chosen. No reason sentence (V2-03.6 Q1). */
function suggestionOf(type: IncidentType): string {
  const suggested = severityLabel(INCIDENT_TYPE_DEFAULT_SEVERITY[type]);
  return `Suggested for ${typeLabelInSentence(type)}: ${suggested}.`;
}

/** The step 2 tiles: the category's types, the ones likely in `zone` first. */
function typeOptionsOf(category: IncidentCategory, zone: Zone | undefined) {
  return typesInCategory(category, typesLikelyIn(zone)).map((value) => ({
    value,
    label: typeLabel(value),
    icon: incidentTypeIcon(value),
  }));
}

/** The API's message, except for the statuses an operator needs explained in their own terms. */
function reportErrorMessage(error: Error, zone: Zone | undefined): string {
  if (!(error instanceof ApiRequestError)) return error.message;
  if (error.status === 422) return REPORT_ALREADY_SENT;
  if (error.status === 403) return NO_LONGER_ALLOWED;
  if (error.status === 429) return TOO_MANY_REQUESTS;
  if (error.status === 400 && error.message.startsWith(OUTSIDE_ZONE_PREFIX)) {
    return `The pin is outside ${zone?.name ?? 'the zone'}. Move it inside the zone or remove it.`;
  }
  return error.message;
}

interface LocationHint {
  tone: HintTone;
  text: string;
}

/** What the line under the location says: a missed pin, where the pin is, or that there is none. */
function locationHintOf(
  zone: Zone | undefined,
  position: LngLat | null,
  missed: boolean,
): LocationHint | null {
  if (missed) return { tone: 'warning', text: 'Place the pin inside a zone.' };
  if (!zone) return null;
  if (position)
    return { tone: 'info', text: `Pin inside ${zone.name} · ${formatLatLng(position)}` };
  return { tone: 'info', text: `No pin: placed at the centre of ${zone.name}.` };
}

/**
 * Operator-reported incident (frames 03, 09): a category, then one of its types, then a severity
 * the type suggests. Limits mirror the API's validation rules; the category is never sent, the API
 * derives it from the type (ADR-0021).
 *
 * The location (zone, pin, "Pick on map") lives in `useConsole`, because the map places the pin and
 * outlines the zone; everything else is this form's own state.
 */
export function ReportIncidentForm() {
  const { data: zones = [] } = useZones();
  const report = useReportIncident();
  const select = useConsole((s) => s.select);
  const closeReport = useConsole((s) => s.closeReport);
  const reportZoneId = useConsole((s) => s.reportZoneId);
  const reportPosition = useConsole((s) => s.reportPosition);
  const picking = useConsole((s) => s.picking);
  const pinMissed = useConsole((s) => s.pinMissed);
  const setReportZone = useConsole((s) => s.setReportZone);
  const setPicking = useConsole((s) => s.setPicking);
  const clearPin = useConsole((s) => s.clearPin);

  const [category, setCategory] = useState<IncidentCategory | null>(null);
  const [type, setType] = useState<IncidentType | null>(null);
  const [severity, setSeverity] = useState<IncidentSeverity>(DEFAULT_SEVERITY);
  // Once the user picks a severity themselves, a type no longer overrides it with its suggestion.
  const [severityByHand, setSeverityByHand] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // One key per opened form, reused by every retry. Not renewed when a field or the pin changes: if
  // a failed attempt actually reached the API, an edited retry must get a 422, not create a duplicate.
  const [idempotencyKey] = useState(newIdempotencyKey);
  // Set by a submit with a required field empty; from then on, empty required fields say so.
  const [attempted, setAttempted] = useState(false);

  const categoryRef = useRef<HTMLFieldSetElement>(null);
  const typeRef = useRef<HTMLFieldSetElement>(null);
  const zoneRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const locationHintId = useId();
  const severityHintId = useId();

  // Opening the form (`N` or the header button) starts at step 1. This runs after `Sheet`'s own
  // layout effect, which focuses the sheet (child effects run first), so the opener `Sheet`
  // recorded still gets focus back on close.
  useLayoutEffect(() => {
    categoryRef.current?.querySelector('input')?.focus({ preventScroll: true });
  }, []);

  const zone = zones.find((z) => z.id === reportZoneId);
  const locationHint = locationHintOf(zone, reportPosition, pinMissed);
  const typeOptions = category ? typeOptionsOf(category, zone) : [];
  const canAcknowledge = usePermissionFor('incident:acknowledge', category);
  // The foot hint's category (frame 09), when it goes to the technicians and this user may take it.
  const queueCategory =
    category !== null && inTechnicianQueue(category) && canAcknowledge ? category : null;

  const chooseCategory = (next: IncidentCategory) => {
    setCategory(next);
    // The severity stays: it is on screen, and a category alone suggests none.
    if (type !== null && categoryOf(type) !== next) setType(null);
  };
  const chooseType = (next: IncidentType) => {
    setType(next);
    if (!severityByHand) setSeverity(INCIDENT_TYPE_DEFAULT_SEVERITY[next]);
  };
  const chooseSeverity = (next: IncidentSeverity) => {
    setSeverity(next);
    setSeverityByHand(true);
  };

  // A severity set only by the suggestion is no draft: the category it came from already is.
  const hasDraft =
    category !== null ||
    type !== null ||
    severityByHand ||
    reportZoneId !== null ||
    reportPosition !== null ||
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

  const missing = {
    category: category === null,
    type: type === null,
    zone: reportZoneId === null,
    title: title.trim() === '',
  };
  const errorFor = (field: keyof typeof MISSING) =>
    attempted && missing[field] ? MISSING[field] : undefined;

  /**
   * Moves focus to the first empty required field, in the order the form shows them. Step 2 is
   * only there once a category is chosen, so a missing type never comes before a missing category.
   */
  const focusFirstMissing = () => {
    if (missing.category) categoryRef.current?.querySelector('input')?.focus();
    else if (missing.type) typeRef.current?.querySelector('input')?.focus();
    else if (missing.zone) zoneRef.current?.focus();
    else titleRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (report.isPending) return;
    if (category === null || type === null || reportZoneId === null || missing.title) {
      setAttempted(true);
      focusFirstMissing();
      return;
    }
    report.mutate(
      {
        request: {
          type,
          severity,
          zoneId: reportZoneId,
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(reportPosition ? { position: reportPosition } : {}),
        },
        idempotencyKey,
      },
      {
        onSuccess: (incident) => {
          // Keyed to the incident: the live `Created` event of this report adds no second toast.
          showToast({
            key: incident.id,
            title: `Reported ${incident.code}`,
            detail: incident.title,
          });
          select(incident.id);
        },
      },
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
        <div className={styles.body}>
          <div className={styles.toprow}>
            <h2 className={styles.title}>Report an incident</h2>
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              aria-label="Cancel report"
              onClick={closeReport}
            >
              Cancel
            </Button>
          </div>

          <SegmentedControl
            ref={categoryRef}
            legend="Category"
            step={1}
            name="category"
            layout="compact-grid"
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={chooseCategory}
            error={errorFor('category')}
          />

          {category && (
            <SegmentedControl
              ref={typeRef}
              legend={`Type — ${categoryLabel(category)}`}
              step={2}
              name="type"
              layout="compact-grid"
              options={typeOptions}
              value={type}
              onChange={chooseType}
              error={errorFor('type')}
            />
          )}

          <div>
            <SegmentedControl
              legend="Severity"
              name="severity"
              options={SEVERITY_OPTIONS}
              value={severity}
              onChange={chooseSeverity}
              describedBy={type ? severityHintId : undefined}
            />
            {type && <Hint id={severityHintId}>{suggestionOf(type)}</Hint>}
          </div>

          <div>
            <div className={styles.location}>
              <Field
                label="Location"
                error={errorFor('zone')}
                describedBy={locationHint ? locationHintId : undefined}
              >
                <Select
                  ref={zoneRef}
                  value={reportZoneId ?? ''}
                  onChange={(e) => setReportZone(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose a zone
                  </option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                icon={MapPin}
                aria-pressed={picking}
                className={styles.pick}
                onClick={() => setPicking(!picking)}
              >
                Pick on map
              </Button>
            </div>
            {locationHint && (
              <div className={styles.pinRow}>
                <Hint id={locationHintId} icon={MapPin} tone={locationHint.tone}>
                  {locationHint.text}
                </Hint>
                {reportPosition && (
                  <Button variant="ghost" size="sm" onClick={clearPin}>
                    Remove pin
                  </Button>
                )}
              </div>
            )}
          </div>

          <Field label="Title" count={`${title.length} / ${TITLE_MAX}`} error={errorFor('title')}>
            <TextInput
              ref={titleRef}
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
        </div>

        {/* Sticky at the bottom of the scrolling sheet, so Report stays in reach (frame 03). */}
        <div className={styles.footer}>
          {report.error && (
            <p className={styles.error} role="alert">
              {reportErrorMessage(report.error, zone)}
            </p>
          )}
          {queueCategory && (
            <Hint>
              {categoryLabel(queueCategory)} incidents go to the technician queue; you can
              acknowledge this one yourself.
            </Hint>
          )}
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              className={styles.grow}
              loading={report.isPending}
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
        </div>
      </form>
    </Sheet>
  );
}
