import type { HealthSegment } from '../../lib/shell/systemHealth';
import { Icon } from '../../ui/Icon';
import {
  Box,
  connectionIcon,
  type Glyph,
  healthIcon,
  MapIcon,
  SlidersHorizontal,
  telemetryIcon,
} from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import { SettingsSwitches } from './SettingsSwitches';
import styles from './StatusBar.module.css';
import { useSystemHealth } from './useSystemHealth';

/*
 * The status bar (V3-06.2, frames 01 and 07): the console's health in one sentence and the three states behind it, at
 * the foot of the console grid. It adds no source of truth (V3 brief § Status bar): `useSystemHealth` reads what the
 * header pills, the banners and the 3D fallback already read, and the words are theirs.
 *
 * - **One live region.** The summary is the only `role="status"`, mounted for good so a change is announced; the
 *   segments are plain text. The pill and the banner announce the same change in their own words (a state, a
 *   consequence), the bar says the overall sentence: three short messages, not a repeat of one.
 * - **No number that is not a count the console already shows**, no FPS (a developer figure, `?debug=twin`). The
 *   only action is Settings (V3-06.3), and only on the console; the segments are text. A segment says its state in a
 *   word and a glyph, never by colour alone.
 * - **Same bar for every role**: reading the state is not an action on the site, and the settings are display
 *   preferences.
 * - **Seams.** Settings sits right of `.segments` (which takes the free width); the alarm-load segment (V3-21.2)
 *   goes after the telemetry one, and the engine's tier word (V3-18) in the engine segment's text; neither is drawn
 *   yet.
 *
 * `readOnly` (the video wall's foot, V3-06.4) draws the same sentence and segments with `SettingsEntry` left out, so the
 * bar has nothing to press or tab to, as `KpiTiles`'s: nobody at a wall can use a control.
 */
export function StatusBar({ readOnly = false }: { readOnly?: boolean }) {
  const { health, connection, telemetry, drawing3d } = useSystemHealth();
  const { engine, events, telemetry: readings } = health.segments;
  return (
    <footer aria-label="System status" className={styles.bar} data-level={health.level}>
      <span role="status" className={styles.health}>
        <Icon glyph={healthIcon(health.level)} size={14} />
        {health.summary}
      </span>
      <span aria-hidden="true" className={styles.divider} />
      <div className={styles.segments}>
        <Segment id="engine" segment={engine} glyph={drawing3d ? Box : MapIcon} />
        <Segment id="events" segment={events} glyph={connectionIcon(connection)} />
        <Segment id="telemetry" segment={readings} glyph={telemetryIcon(telemetry)} />
      </div>
      {!readOnly && <SettingsEntry />}
    </footer>
  );
}

/**
 * The display and sound preferences, the account menu's rows (`SettingsSwitches`, V3-06.3), in a popover that opens
 * upward: the bar is at the foot of the screen. The help entry closes the popover first, so the help dialog returns
 * focus to this button.
 */
function SettingsEntry() {
  return (
    <Popover
      placement="above"
      panelLabel="Settings"
      className={styles.settings}
      triggerClassName={styles.settingsTrigger}
      trigger={
        <>
          <Icon glyph={SlidersHorizontal} size={14} />
          Settings
        </>
      }
    >
      {(close) => <SettingsSwitches close={close} />}
    </Popover>
  );
}

function Segment({ id, segment, glyph }: { id: string; segment: HealthSegment; glyph: Glyph }) {
  return (
    <span className={styles.segment} data-segment={id} data-state={segment.state}>
      <Icon glyph={glyph} size={14} />
      <span className={styles.label}>{segment.label}</span>
      {/* A space between the two, so the text reads "Events Live" and not "EventsLive"; the gap is the layout's. */}{' '}
      <span className={styles.text}>{segment.text}</span>
    </span>
  );
}
