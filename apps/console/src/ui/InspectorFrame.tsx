import { type ReactNode, type Ref, useState } from 'react';
import styles from './InspectorFrame.module.css';
import { Sheet } from './Sheet';
import { Tabs } from './Tabs';

/** One tab of the frame: what its label says and what its panel holds. */
export interface InspectorTab<T extends string = string> {
  value: T;
  label: string;
  /** Shown after the label and part of the tab's accessible name (frame 03: "Related 3"). */
  count?: number;
  content: ReactNode;
}

/**
 * The one frame of the inspector (frames 02, 03, 04): the incident's detail and the asset inspector
 * are two contents of it. It renders the `Sheet`, so the focus, Escape and opener rules are the
 * sheet's and unchanged, and puts three things inside it, in this order: the `header`, the panel
 * and the `foot`.
 *
 * - **One tab draws no tab list.** The panel is then that tab's content as it is, with no wrapper,
 *   so the sheet's children are the same list as before the frame: the sticky foot stays a direct
 *   child of the scrolling sheet. Two or more tabs use `Tabs` (WAI-ARIA tabs, automatic
 *   activation, one tab stop), which renders only the selected tab's content in one panel named by
 *   its tab.
 * - **The foot is outside the tab panel**, so a tab change never touches it. Roles and their
 *   footers are the content's business: the frame only gives the slot.
 * - **The tab state is the frame's** (uncontrolled), starting on the first tab. The contents are
 *   keyed by id in `App`, so a new incident or asset remounts the frame and opens on the first tab
 *   (V3-09 open question 13). A selected tab that is no longer in `tabs` falls back to the first.
 * - **The frame does not own the Close button.** It sits in the `header`, because Close and
 *   Escape are not always the same step (the asset inspector's Escape first closes a part's
 *   callout, Close ends the inspector). `onEscape` is only what `Sheet` calls for Escape.
 * - **It does not pin anything yet:** the `Sheet` still scrolls as a whole and the foot is sticky
 *   in it, as before (V3-09.1). The incident sheet is the first content with several tabs
 *   (V3-09.5) and does not pin either: pinning the header and the tab list is a follow-up task.
 *
 * Render the frame once per content, in every state (loading, failed, loaded), and vary its slots:
 * a second frame in another branch would remount the `Sheet` and move focus when the data arrives.
 * `tabs` empty draws nothing between the header and the foot.
 */
export function InspectorFrame<T extends string>({
  label,
  ref,
  onEscape,
  keepOpen,
  keptMessage,
  onEscapeKept,
  header,
  tabsLabel,
  tabs,
  foot,
}: {
  /** The sheet's accessible name. */
  label: string;
  /** The sheet element, e.g. to focus it again when the control that had focus disappears. */
  ref?: Ref<HTMLElement>;
  onEscape: () => void;
  keepOpen?: boolean;
  keptMessage?: string;
  onEscapeKept?: () => void;
  header: ReactNode;
  /** Names the tab list; read only when there are two or more tabs. */
  tabsLabel: string;
  tabs: readonly InspectorTab<T>[];
  foot?: ReactNode;
}) {
  const [selected, setSelected] = useState<T | undefined>(tabs[0]?.value);
  const active = tabs.find((tab) => tab.value === selected) ?? tabs[0];

  return (
    <Sheet
      ref={ref}
      label={label}
      onClose={onEscape}
      keepOpen={keepOpen}
      keptMessage={keptMessage}
      onEscapeKept={onEscapeKept}
    >
      {header}
      {active &&
        (tabs.length > 1 ? (
          <Tabs
            label={tabsLabel}
            tabs={tabs}
            value={active.value}
            onChange={setSelected}
            panelClassName={styles.panel}
          >
            {active.content}
          </Tabs>
        ) : (
          active.content
        ))}
      {foot}
    </Sheet>
  );
}
