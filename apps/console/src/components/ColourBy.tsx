import {
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { HEAT_MEASURES, INDOOR_TEMPERATURE } from '../lib/heatMeasures';
import { levelOf, showsHeat } from '../lib/twinLevel';
import { useConsole } from '../store';
import { Icon } from '../ui/Icon';
import { Check, ChevronDown } from '../ui/icons';
import styles from './ColourBy.module.css';

/**
 * Frame 13's "Colour by" picker (V2-17.4, ADR-0020 "Settled in V2-17.1" and "V2-17.4"): a button naming the measure the
 * heat overlay colours by, which opens a listbox of the measures. There is one ("Indoor temperature"), so a second is
 * a data addition (`lib/heatMeasures.ts`), not a redesign.
 *
 * - **Shown only while the overlay is drawn**: the layer is on and the level is the campus or a building
 *   (`showsHeat`, the one place the level is read). Off, it would be a control for nothing. It stands in the tools row
 *   beside the layers (`StageView`), so it is main-chunk code and imports no `src/twin/` module.
 * - **A collapsible dropdown listbox** (WAI-ARIA APG): the button has `aria-haspopup="listbox"`, `aria-expanded` and
 *   `aria-controls`; opening moves focus to the listbox, whose active option is `aria-activedescendant` (one focus
 *   target, no roving `tabindex` over a list of one). Enter, Space, ArrowDown and ArrowUp on the button open it;
 *   in the list the arrows and Home/End move the active option, Enter, Space or a click choose it, **Escape closes it
 *   and returns focus to the button**, and Tab, a pointer down outside or focus leaving closes it.
 * - **While open it owns Escape**: the key is stopped in the capture phase (as `ui/Popover` does), so the sheet, the
 *   search box, the part callout and the picking mode do not also act on it.
 * - **Choosing changes nothing**: with one measure the selection is a constant, not state. The tick on the option and
 *   `aria-selected` say which it is; the button says it in words.
 * - The same for every role: choosing what to draw is not an action on the site, so it reads no session and no
 *   permission (V2-17.4).
 */
export function ColourBy() {
  const shown = useConsole((state) => state.layers.heat && showsHeat(levelOf(state)));
  // A component of its own below, so the picker starts closed each time the overlay comes back.
  return shown ? <Picker /> : null;
}

const SELECTED = INDOOR_TEMPERATURE;
const SELECTED_INDEX = Math.max(0, HEAT_MEASURES.indexOf(SELECTED));
const LAST_INDEX = HEAT_MEASURES.length - 1;

function Picker() {
  const id = useId();
  const triggerId = `${id}-trigger`;
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(SELECTED_INDEX);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);

  // Finds the trigger by id, not through a ref: `close` is a dependency of an effect and is also called from
  // handlers, and a function that reads a ref must not be handed around during render (react-hooks/refs).
  const close = useCallback(() => {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  }, [triggerId]);

  const openList = () => {
    setActive(SELECTED_INDEX);
    setOpen(true);
  };

  // Focus goes into the list once it is shown (it is `hidden` until then, and a hidden element cannot take focus).
  useEffect(() => {
    if (open) listboxRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase on the document: runs before the window-level Escape listeners, and also when focus is on
    // the page body (Safari does not focus a button on click).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  // Only a move to a known element outside closes it; a null target is a click on non-focusable text or a switch to
  // another window, and outside clicks are handled by the pointer listener above.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next && !event.currentTarget.contains(next)) setOpen(false);
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openList();
  };

  // One measure, so choosing it only closes the list. A second measure adds its setter here (ADR-0020 "Settled in
  // V2-17.4"), together with the store field it would write.
  const choose = () => close();

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        setActive((index) => Math.min(index + 1, LAST_INDEX));
        break;
      case 'ArrowUp':
        setActive((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(LAST_INDEX);
        break;
      case 'Enter':
      case ' ':
        choose();
        break;
      case 'Tab':
        // Not prevented: focus moves on, and the list is closed behind it.
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div ref={rootRef} className={styles.root} onBlur={onBlur}>
      <button
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKeyDown}
      >
        Colour by <span className={styles.value}>{SELECTED.label}</span>
        <Icon glyph={ChevronDown} size={16} className={styles.chevron} />
      </button>
      {/* Always rendered so `aria-controls` points at a real element; `hidden` keeps it out of the tree while closed. */}
      <ul
        ref={listboxRef}
        id={listboxId}
        role="listbox"
        aria-label="Colour by"
        aria-activedescendant={open ? optionId(active) : undefined}
        tabIndex={-1}
        hidden={!open}
        className={styles.listbox}
        onKeyDown={onListKeyDown}
      >
        {HEAT_MEASURES.map((measure, index) => (
          <li
            key={measure.id}
            id={optionId(index)}
            role="option"
            aria-selected={measure.id === SELECTED.id}
            data-active={index === active || undefined}
            className={styles.option}
            onClick={choose}
          >
            <span className={styles.mark}>
              {measure.id === SELECTED.id && <Icon glyph={Check} size={16} />}
            </span>
            {measure.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
