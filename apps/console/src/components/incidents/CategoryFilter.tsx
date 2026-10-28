import { INCIDENT_CATEGORIES, type IncidentCategory } from '@occ/contracts';
import type { Ref } from 'react';
import { categoryLabel } from '../../lib/incidents/incidents';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { categoryIcon, Funnel } from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import styles from './CategoryFilter.module.css';

/**
 * The feed's category filter (frame 01's filter button beside the search, V3-07.3): a button that opens a panel
 * with the six categories as toggles (`aria-pressed`) and Clear. One category at a time, because the six are
 * exclusive by type (ADR-0021). Choosing one, or Clear, closes the panel and puts focus back on the button.
 *
 * It draws the choice only: the feed owns the state, the chip that names the active category and the focus rule
 * for that chip's Clear, which is why the trigger is handed out as `triggerRef`. The trigger carries its glyph and
 * a dot while a category is chosen; the chip is what names it, so the cue is never the only signal. The trigger is
 * named "Filter by category" and the panel "Filter incidents by category", so the two names do not collide.
 *
 * The options are `ghost` buttons: the panel is glass, where a `secondary` button's boundary is under 3:1.
 */
export function CategoryFilter({
  category,
  onChange,
  triggerRef,
  className,
}: {
  category: IncidentCategory | null;
  onChange: (category: IncidentCategory | null) => void;
  triggerRef?: Ref<HTMLButtonElement>;
  className?: string;
}) {
  return (
    <Popover
      className={className}
      triggerLabel="Filter by category"
      triggerClassName={styles.trigger}
      triggerRef={triggerRef}
      panelLabel="Filter incidents by category"
      trigger={
        <span className={styles.glyph} data-active={category !== null}>
          <Icon glyph={Funnel} size={18} />
          {category !== null && <span className={styles.dot} aria-hidden="true" />}
        </span>
      }
    >
      {(close) => (
        <>
          <div className={styles.options}>
            {INCIDENT_CATEGORIES.map((option) => (
              <Button
                key={option}
                variant="ghost"
                icon={categoryIcon(option)}
                className={styles.option}
                aria-pressed={category === option}
                onClick={() => {
                  onChange(category === option ? null : option);
                  close();
                }}
              >
                {categoryLabel(option)}
              </Button>
            ))}
          </div>
          <hr className={styles.separator} />
          <Button
            variant="ghost"
            className={styles.option}
            disabled={category === null}
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            Clear
          </Button>
        </>
      )}
    </Popover>
  );
}
