import type { Incident } from '@occ/contracts';
import {
  acknowledgeDuration,
  eventLabel,
  formatClock,
  formatDuration,
  isPastAttention,
  type LifecycleStep,
  lifecycleSteps,
  openDuration,
} from '../lib/incidents';
import { useNow } from '../lib/useNow';
import { Icon } from '../ui/Icon';
import { Clock } from '../ui/icons';
import styles from './IncidentLifecycle.module.css';

/**
 * Where the incident stands (frame 02): the Reported → Acknowledged → Resolved stepper with the
 * time of each step, then how long it has been open and how long it took to acknowledge. The
 * stepper carries the status, so the head shows no status chip next to it.
 */
export function IncidentLifecycle({ incident }: { incident: Incident }) {
  const now = useNow();
  const open = openDuration(incident, now);
  const toAcknowledge = acknowledgeDuration(incident);
  // Same threshold as the feed row's age, so both flag the same incidents.
  const late = isPastAttention(incident, now);

  return (
    <div className={styles.lifecycle}>
      <ol className={styles.stepper} aria-label="Lifecycle">
        {lifecycleSteps(incident).map((step) => (
          <li
            key={step.kind}
            className={styles.step}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className={styles.dot} />
            <b className={styles.label}>{eventLabel(step.kind)}</b>
            <small className={styles.when}>
              <StepWhen step={step} now={now} />
            </small>
          </li>
        ))}
      </ol>
      <dl className={styles.metrics}>
        <div className={styles.metric}>
          <dt>{open.final ? 'Was open for' : 'Open for'}</dt>
          <dd data-late={late || undefined}>
            {late && <Icon glyph={Clock} size={18} />}
            {formatDuration(open.ms)}
            {late && <span className={styles.hidden}>, past attention time</span>}
          </dd>
        </div>
        <div className={styles.metric}>
          <dt>Time to acknowledge</dt>
          <dd>
            {toAcknowledge === 'pending'
              ? 'Not yet'
              : toAcknowledge === 'skipped'
                ? 'Skipped'
                : formatDuration(toAcknowledge)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function StepWhen({ step, now }: { step: LifecycleStep; now: number }) {
  switch (step.state) {
    case 'done':
      return <time dateTime={step.at ?? undefined}>{step.at && formatClock(step.at, now)}</time>;
    case 'current':
      return 'Waiting';
    case 'skipped':
      return 'Skipped';
    case 'future':
      return (
        <>
          <span aria-hidden="true">—</span>
          <span className={styles.hidden}>Not yet</span>
        </>
      );
  }
}
