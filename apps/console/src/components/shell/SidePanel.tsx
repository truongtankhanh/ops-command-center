import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { useAssets, useIncidents } from '../../api/queries';
import { isActive } from '../../lib/incidents/incidents';
import { type SidePanelTab, useConsole } from '../../store';
import { nextTabIndex } from '../../ui/tabNavigation';
import styles from './SidePanel.module.css';

const TABS: readonly { value: SidePanelTab; label: string }[] = [
  { value: 'incidents', label: 'Incidents' },
  { value: 'assets', label: 'Assets' },
];

/**
 * The side column (frame 01): a two-tab switch, "Incidents {active}" and "Assets {catalogue}", over
 * the panel it selects. The switch is the WAI-ARIA tabs pattern with automatic activation, like
 * `ui/Tabs`: one Tab stop on the selected tab, ← / → (wrapping), Home and End move and select.
 * `ui/Tabs` itself has one panel for all its tabs, so this keeps its own list.
 *
 * **Both panels stay mounted**, the inactive one `hidden`, so the incident feed keeps its search
 * text, its roving focus and its live handling while the assets are shown. A panel arrives as a
 * slot so that `App` wraps each in its own error boundary: a crash in one leaves the other working.
 *
 * The incident count is the active incidents, unfiltered (the KPI tiles' sum), not the feed's tab
 * count: that follows a severity chip and a search the switch cannot see. A count that is not known
 * yet (list loading or failed) is left out rather than drawn as 0.
 */
export function SidePanel({ incidents, assets }: { incidents: ReactNode; assets: ReactNode }) {
  const panel = useConsole((s) => s.sidePanel);
  const setPanel = useConsole((s) => s.setSidePanel);
  const { data: incidentList } = useIncidents();
  const { data: assetList } = useAssets();
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const counts: Record<SidePanelTab, number | undefined> = {
    incidents: incidentList?.filter(isActive).length,
    assets: assetList?.length,
  };
  const slots: Record<SidePanelTab, ReactNode> = { incidents, assets };
  const tabId = (tab: SidePanelTab) => `${id}-tab-${tab}`;
  const panelId = (tab: SidePanelTab) => `${id}-panel-${tab}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabRefs.current.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    const next = nextTabIndex(event.key, current, TABS.length);
    if (next === null) return;
    const target = TABS[next];
    if (!target) return;
    event.preventDefault();
    setPanel(target.value);
    tabRefs.current[next]?.focus();
  };

  return (
    <aside id="side-panel" className={styles.side} aria-label="Incidents and assets">
      <div role="tablist" aria-label="Side panel" className={styles.switch} onKeyDown={onKeyDown}>
        {TABS.map((tab, index) => {
          const count = counts[tab.value];
          return (
            <button
              key={tab.value}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId(tab.value)}
              className={styles.tab}
              aria-selected={panel === tab.value}
              aria-controls={panelId(tab.value)}
              tabIndex={panel === tab.value ? 0 : -1}
              onClick={() => setPanel(tab.value)}
            >
              {tab.label}
              {/* The space keeps the accessible name "Incidents 8", not "Incidents8". */}
              {count !== undefined && (
                <>
                  {' '}
                  <span className={styles.count}>{count}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.value}
          role="tabpanel"
          id={panelId(tab.value)}
          aria-labelledby={tabId(tab.value)}
          hidden={panel !== tab.value}
          className={styles.panel}
        >
          {slots[tab.value]}
        </div>
      ))}
    </aside>
  );
}
