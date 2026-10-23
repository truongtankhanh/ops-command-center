import { type LoadStep, loadedShare, type StepState } from '../../lib/twin-core/twinLoading';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Check, CircleDot, CircleX } from '../../ui/icons';
import styles from './TwinLoading.module.css';

const STATE_ICON = { done: Check, failed: CircleX, active: CircleDot, queued: CircleDot };

/** Said to assistive tech, in the list that is not announced as it changes. */
const STATE_WORD: Record<StepState, string> = {
  done: 'done',
  active: 'loading',
  queued: 'waiting',
  failed: 'failed',
};

interface TwinLoadingProps {
  steps: readonly LoadStep[];
  /** Offered beside a step that failed. */
  onRetry?: () => void;
  /** That retry is under way. */
  retrying?: boolean;
}

/**
 * Frame 06's loading card (V2-12.11), bottom-left of the 3D stage: what the stage is waiting for, as a title, one
 * sentence, a progress bar and a row per step. The incidents, the cameras and the actions stay usable around it.
 *
 * - **Announced once.** The card is a `status` whose text is static, so it is read when it appears; the bar's
 *   value is an attribute and the step list is `aria-live="off"`, so a step finishing is not read again. The one
 *   change of text is the title when a step fails: that is news, and is read.
 * - **No spinner** (brief Principle 5: only arrival, selection and escalation animate): a done step is a check, a
 *   failed one a cross, the rest a dot, and the bar's width is the share of steps done, not an animation.
 *   Shape and words carry the state, so colour is never the only cue.
 * - A failed step offers Retry. The steps are data (`lib/twin-core/twinLoading.ts`): V2-14.7 adds one per equipment model.
 *
 * It is main-chunk code: it has to show before the twin chunk, and its CSS, have arrived.
 */
export function TwinLoading({ steps, onRetry, retrying = false }: TwinLoadingProps) {
  const done = steps.filter(({ state }) => state === 'done').length;
  const failed = steps.some(({ state }) => state === 'failed');

  return (
    <div role="status" className={styles.card}>
      <strong className={styles.title}>
        {failed ? 'The 3D view is not ready' : 'Loading the 3D view'}
      </strong>
      <p className={styles.note}>Incidents and cameras are in the feed and the 2D view.</p>
      <div
        role="progressbar"
        aria-label="Loading the 3D view"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        className={styles.bar}
      >
        <i className={styles.fill} style={{ width: `${loadedShare(steps) * 100}%` }} />
      </div>
      <ul aria-live="off" className={styles.steps}>
        {steps.map(({ id, label, detail, state }) => (
          <li key={id} data-state={state}>
            <Icon glyph={STATE_ICON[state]} size={16} className={styles.icon} />
            <span>
              {label}
              <span className={styles.hidden}>, {STATE_WORD[state]}</span>
            </span>
            <b>{detail}</b>
            {state === 'failed' && onRetry && (
              <Button size="sm" loading={retrying} onClick={onRetry}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
