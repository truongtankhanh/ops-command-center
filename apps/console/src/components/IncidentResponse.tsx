import type { IncidentCategory, IncidentDetail } from '@occ/contracts';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ApiRequestError, NO_LONGER_ALLOWED, TOO_MANY_REQUESTS } from '../api/client';
import { useTransition } from '../api/queries';
import { usePermission, usePermissionFor } from '../auth/usePermission';
import { categoryLabel, categoryOfType } from '../lib/incidents';
import { useShortcut } from '../lib/useShortcut';
import { useConsole } from '../store';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Textarea } from '../ui/Field';
import { focusLost } from '../ui/focus';
import { Hint } from '../ui/Hint';
import { Icon } from '../ui/Icon';
import { Eye, Info } from '../ui/icons';
import styles from './IncidentResponse.module.css';

/** Shown under a note being written, and announced by the sheet when Escape is ignored for it. */
export const NOTE_KEPT = 'Esc keeps your note. Close discards it.';

/** The API's message, except for the statuses an operator needs explained in their own terms. */
function transitionErrorMessage(error: Error): string {
  if (!(error instanceof ApiRequestError)) return error.message;
  if (error.status === 403) return NO_LONGER_ALLOWED;
  if (error.status === 429) return TOO_MANY_REQUESTS;
  return error.message;
}

/**
 * The foot of the incident sheet (frames 02 / 06 / 11). Only the actions the user's roles grant,
 * for this incident's category, are shown; the API refuses the rest anyway (ADR-0011, ADR-0021). A
 * user who may take neither action gets a footer saying why instead of a gap, on every status: the
 * view-only one for a role without the permissions, the out-of-scope one for a role whose
 * category scope does not cover this incident (a technician on a security incident, or on a type
 * this console does not know). A user who may act on it gets none once it is resolved.
 */
export function IncidentResponse({ incident, kept }: { incident: IncidentDetail; kept: boolean }) {
  const canAcknowledge = usePermission('incident:acknowledge');
  const canResolve = usePermission('incident:resolve');
  const category = categoryOfType(incident.type);
  const mayAcknowledge = usePermissionFor('incident:acknowledge', category);
  const mayResolve = usePermissionFor('incident:resolve', category);
  if (!canAcknowledge && !canResolve) return <ViewOnlyFooter />;
  if (!mayAcknowledge && !mayResolve) return <OutOfScopeFooter category={category} />;

  const showAcknowledge = incident.status === 'open' && mayAcknowledge;
  const showResolve = incident.status !== 'resolved' && mayResolve;
  if (!showAcknowledge && !showResolve) return null;
  return (
    <ResponseForm
      incident={incident}
      kept={kept}
      showAcknowledge={showAcknowledge}
      showResolve={showResolve}
    />
  );
}

function ViewOnlyFooter() {
  return (
    <div className={styles.viewOnly} role="note" data-footer="view-only">
      <Icon glyph={Eye} size={18} className={styles.viewOnlyIcon} />
      <p className={styles.viewOnlyText}>
        <strong>View only</strong> Acknowledging and resolving need the operator or supervisor role.
      </p>
    </div>
  );
}

/**
 * The view-only footer's twin for a user who may act, but not on this category (frame 11): the
 * same note, so the sheet never ends in a gap. `A` / `R` are registered by `ResponseForm`, which is
 * not rendered here, so they do nothing. `null` is a type this console does not know, which is out
 * of every limited scope (fail closed), and has no category to name.
 */
function OutOfScopeFooter({ category }: { category: IncidentCategory | null }) {
  const subject =
    category === null ? 'Incidents of this type' : `${categoryLabel(category)} incidents`;
  return (
    <div className={styles.viewOnly} role="note" data-footer="out-of-scope">
      <Icon glyph={Info} size={18} className={styles.viewOnlyIcon} />
      <p className={styles.viewOnlyText}>
        {/* V2-03.8 adds "Your queue is in Mine to handle ({n})." once the tab exists. */}
        <strong>{subject} are handled by operators</strong> You can follow this one and report new
        incidents.
      </p>
    </div>
  );
}

/**
 * Note, actions and their shortcuts. `A` / `R` work like the buttons, from anywhere in the console
 * except a text field (so typing the note never acknowledges), and only while the button is there
 * and idle, and while single-key shortcuts are on. Resolving a critical incident without a note
 * asks first, whether by click or by `R`.
 *
 * Once the incident is acknowledged — here or by someone else — the Acknowledge button goes. If it
 * had focus, focus moves to Resolve, the next step, so it never falls out of the sheet.
 */
function ResponseForm({
  incident,
  kept,
  showAcknowledge,
  showResolve,
}: {
  incident: IncidentDetail;
  kept: boolean;
  showAcknowledge: boolean;
  showResolve: boolean;
}) {
  const note = useConsole((s) => s.noteDrafts[incident.id] ?? '');
  const setNote = useConsole((s) => s.setNote);
  const clearNote = useConsole((s) => s.clearNote);
  const acknowledge = useTransition('acknowledge');
  const resolve = useTransition('resolve');
  const [confirming, setConfirming] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const resolveRef = useRef<HTMLButtonElement>(null);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  const busy = acknowledge.isPending || resolve.isPending;
  const error = acknowledge.error ?? resolve.error;
  const hasNote = note.trim() !== '';

  // `mutate` is stable across renders, so these change only with the note or the incident.
  const { mutate: sendAcknowledge } = acknowledge;
  const { mutate: sendResolve } = resolve;
  const send = useCallback(
    (mutate: typeof sendAcknowledge) =>
      mutate(
        { id: incident.id, note: note.trim() || undefined },
        { onSuccess: () => clearNote(incident.id) },
      ),
    [clearNote, incident.id, note],
  );
  const runAcknowledge = useCallback(() => send(sendAcknowledge), [send, sendAcknowledge]);
  const needsConfirmation = incident.severity === 'critical' && !hasNote;
  const requestResolve = useCallback(() => {
    if (needsConfirmation) setConfirming(true);
    else send(sendResolve);
  }, [needsConfirmation, send, sendResolve]);

  const acknowledgeKeyWorks = keysOn && showAcknowledge && !busy && !confirming;
  const resolveKeyWorks = keysOn && showResolve && !busy && !confirming;
  useShortcut('a', runAcknowledge, acknowledgeKeyWorks);
  useShortcut('r', requestResolve, resolveKeyWorks);

  // The status can change while a request still disables Resolve, which cannot take focus then: the
  // move waits for `busy` to clear. Focus is only moved when it was lost (UI-11 DN-6).
  const hadAcknowledge = useRef(showAcknowledge);
  const acknowledgeGone = useRef(false);
  useLayoutEffect(() => {
    if (hadAcknowledge.current && !showAcknowledge) acknowledgeGone.current = true;
    hadAcknowledge.current = showAcknowledge;
    if (!acknowledgeGone.current || busy) return;
    acknowledgeGone.current = false;
    if (focusLost()) resolveRef.current?.focus();
  }, [showAcknowledge, busy]);

  // Focus first, then close: the dialog only returns focus when it was lost with it.
  const addNote = () => {
    noteRef.current?.focus();
    setConfirming(false);
  };
  const confirmResolve = () => {
    setConfirming(false);
    send(sendResolve);
  };

  return (
    <form
      className={styles.footer}
      aria-label="Response"
      data-footer="response"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field label="Note for the timeline (optional)">
        <Textarea
          ref={noteRef}
          className={styles.note}
          value={note}
          onChange={(event) => setNote(incident.id, event.target.value)}
          placeholder="e.g. Guard dispatched from the main gate"
          maxLength={1000}
        />
      </Field>
      {hasNote && <Hint tone={kept ? 'warning' : 'info'}>{NOTE_KEPT}</Hint>}
      <div className={styles.actions}>
        {showAcknowledge && (
          <Button
            variant="primary"
            className={styles.grow}
            disabled={busy}
            shortcut={acknowledgeKeyWorks ? 'A' : undefined}
            onClick={runAcknowledge}
          >
            Acknowledge
          </Button>
        )}
        {showResolve && (
          <Button
            ref={resolveRef}
            // One primary action at a time. `secondary` would fail 3:1 on this footer's surface-2.
            variant={showAcknowledge ? 'ghost' : 'primary'}
            className={styles.grow}
            disabled={busy}
            shortcut={resolveKeyWorks ? 'R' : undefined}
            onClick={requestResolve}
          >
            Resolve
          </Button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {transitionErrorMessage(error)}
        </p>
      )}
      {confirming && (
        <Dialog
          title={`Resolve ${incident.code} without a note?`}
          onCancel={() => setConfirming(false)}
          actions={
            <>
              <Button variant="ghost" onClick={addNote}>
                Add a note
              </Button>
              <Button variant="primary" onClick={confirmResolve}>
                Resolve without note
              </Button>
            </>
          }
        >
          <p>Critical incidents are normally resolved with a note for the timeline.</p>
        </Dialog>
      )}
    </form>
  );
}
