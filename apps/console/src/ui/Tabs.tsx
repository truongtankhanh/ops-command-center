import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from 'react';
import { focusLost } from './focus';
import { nextTabIndex } from './tabNavigation';
import styles from './Tabs.module.css';

/** What a keyboard user can reach with Tab inside a panel: not a disabled control, not `tabindex="-1"`. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([tabindex="-1"])`)
  .join(', ');

/**
 * Makes `panel` a Tab stop when `reachable` and nothing in it is focusable, else takes the stop away.
 * It writes only when the answer changes, so the observer that calls it never feeds on its own write.
 */
function syncPanelStop(panel: HTMLElement | null, reachable: boolean) {
  if (!panel) return;
  const stop = reachable && panel.querySelector(FOCUSABLE) === null;
  if (stop && panel.getAttribute('tabindex') !== '0') panel.setAttribute('tabindex', '0');
  if (!stop && panel.hasAttribute('tabindex')) panel.removeAttribute('tabindex');
}

/**
 * A tab list with one panel (WAI-ARIA APG tabs pattern, automatic activation): the list is a single
 * Tab stop on the selected tab; ← / → (wrapping), Home and End move focus and select at once,
 * which suits tabs that switch a local view instantly.
 *
 * All tabs control the same panel, which wraps `children` and is labelled by the selected tab, so
 * the consumer renders the content of the selected tab only. The panel takes no tab stop of its
 * own: the content it holds is expected to be focusable (e.g. list rows). With `reachablePanel` a
 * panel that holds nothing focusable becomes a tab stop itself (APG: otherwise a keyboard user
 * cannot reach, or scroll, content that is only text); it stops being one as soon as something
 * focusable appears in it.
 *
 * A tab with a `count` shows it after its label, and the count is part of the tab's accessible
 * name ("Active 4"), so assistive tech hears the number the screen shows.
 *
 * `appearance` is only the look: `'bar'` (default) marks the selected tab with a lit bar, `'chips'`
 * draws each tab as a chip (frame 01's filter row) for a row that sits under another lit-bar row, so
 * the column keeps one. Markup, roles and keys are the same in both.
 *
 * Renders the list and the panel as siblings; place them with `className` / `panelClassName`.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  appearance = 'bar',
  reachablePanel = false,
  className,
  panelClassName,
  children,
}: {
  label: string;
  tabs: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  appearance?: 'bar' | 'chips';
  /** Makes a panel with nothing focusable in it a tab stop (`tabindex="0"`); off by default. */
  reachablePanel?: boolean;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  // Set when the tab that has focus is detached; acted on after the commit, if focus really was lost.
  const focusedTabDetached = useRef(false);
  const selected = tabs.findIndex((tab) => tab.value === value);
  // A value that matches no tab selects none, but the first tab stays reachable by keyboard.
  const focusable = Math.max(0, selected);
  const tabId = (index: number) => `${id}-tab-${index}`;
  const panelId = `${id}-panel`;

  // The panel's own tab stop is set on the element, not rendered: it follows what is inside, which
  // changes after every render of the tabs (a tab change, the consumer's own state) and also without
  // one (data arriving in a child), so it is synced after each render and on each DOM change below.
  useLayoutEffect(() => {
    syncPanelStop(panelRef.current, reachablePanel);
    // The focused tab went away (a tab that is no longer offered): focus follows the selection to the
    // tab that is, instead of falling to the page. A tab that merely re-rendered kept focus.
    if (focusedTabDetached.current) {
      focusedTabDetached.current = false;
      if (focusLost()) tabRefs.current[Math.max(0, selected)]?.focus();
    }
  });
  useEffect(() => {
    const panel = panelRef.current;
    if (!reachablePanel || !panel) return;
    const observer = new MutationObserver(() => syncPanelStop(panel, reachablePanel));
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'tabindex', 'href'],
    });
    return () => observer.disconnect();
  }, [reachablePanel]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabRefs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = nextTabIndex(event.key, current, tabs.length);
    if (next === null) return;
    const target = tabs[next];
    if (!target) return;
    event.preventDefault();
    onChange(target.value);
    tabRefs.current[next]?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        data-appearance={appearance === 'chips' ? 'chips' : undefined}
        className={className ? `${styles.list} ${className}` : styles.list}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            ref={(element) => {
              tabRefs.current[index] = element;
              return () => {
                // Runs before the element leaves the page, so it still has focus if it had it.
                if (element !== null && element === document.activeElement) {
                  focusedTabDetached.current = true;
                }
                if (tabRefs.current[index] === element) tabRefs.current[index] = null;
              };
            }}
            type="button"
            role="tab"
            id={tabId(index)}
            className={styles.tab}
            aria-selected={index === selected}
            aria-controls={panelId}
            tabIndex={index === focusable ? 0 : -1}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
            {/* The space keeps the accessible name "Active 4", not "Active4". */}
            {tab.count !== undefined && (
              <>
                {' '}
                <span className={styles.count}>{tab.count}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        ref={panelRef}
        id={panelId}
        aria-labelledby={selected < 0 ? undefined : tabId(selected)}
        className={panelClassName}
      >
        {children}
      </div>
    </>
  );
}
