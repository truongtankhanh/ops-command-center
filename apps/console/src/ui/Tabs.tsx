import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { nextTabIndex } from './tabNavigation';
import styles from './Tabs.module.css';

/**
 * A tab list with one panel (WAI-ARIA APG tabs pattern, automatic activation): the list is a single
 * Tab stop on the selected tab; ← / → (wrapping), Home and End move focus and select at once,
 * which suits tabs that switch a local view instantly.
 *
 * All tabs control the same panel, which wraps `children` and is labelled by the selected tab, so
 * the consumer renders the content of the selected tab only. The panel takes no tab stop of its
 * own: the content it holds is expected to be focusable (e.g. list rows).
 *
 * A tab with a `count` shows it after its label, and the count is part of the tab's accessible
 * name ("Active 4"), so assistive tech hears the number the screen shows.
 *
 * Renders the list and the panel as siblings; place them with `className` / `panelClassName`.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  className,
  panelClassName,
  children,
}: {
  label: string;
  tabs: readonly { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = tabs.findIndex((tab) => tab.value === value);
  // A value that matches no tab selects none, but the first tab stays reachable by keyboard.
  const focusable = Math.max(0, selected);
  const tabId = (index: number) => `${id}-tab-${index}`;
  const panelId = `${id}-panel`;

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
        className={className ? `${styles.list} ${className}` : styles.list}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            ref={(element) => {
              tabRefs.current[index] = element;
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
        id={panelId}
        aria-labelledby={selected < 0 ? undefined : tabId(selected)}
        className={panelClassName}
      >
        {children}
      </div>
    </>
  );
}
