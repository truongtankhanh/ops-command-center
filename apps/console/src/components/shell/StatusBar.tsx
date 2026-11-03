import { ALARM_RATE_WINDOW_MS } from '../../lib/incidents/alarmLoad';
import { type AlarmLoad, useAlarmLoad } from '../../lib/incidents/useAlarmLoad';
import type { HealthSegment } from '../../lib/shell/systemHealth';
import { Icon } from '../../ui/Icon';
import {
  alarmLoadIcon,
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
 * - **No number that is not a count the console already shows**, no FPS (a developer figure, `?debug=twin`). The alarm
 *   rate (V3-21.2) is such a count: the incidents the feed lists, reported in the last 10 minutes. The actions are
 *   Settings (V3-06.3) and the alarm-load button, only on the console; the three health segments are text. A segment says
 *   its state in a word and a glyph, never by colour alone.
 * - **A flood is workload, not a fault.** The alarm-load segment reads `useAlarmLoad` and never enters `systemHealth`, so
 *   the summary stays "System healthy" and `data-level` does not change during a flood. The flood start is announced by
 *   the banner (V3-21.4), not here: the segment is not a live region.
 * - **Same bar for every role**: reading the state is not an action on the site, and the settings are display
 *   preferences.
 * - **Seams.** The alarm-load slot follows `.segments` and is outside it, so the panel V3-21.3 opens upward from the
 *   button is not clipped by `.segments`' `overflow` (as Settings); the engine's tier word (V3-18) goes in the engine
 *   segment's text and is not drawn yet.
 *
 * `readOnly` (the video wall's foot, V3-06.4) draws the same sentence and segments with `SettingsEntry` left out, so the
 * bar has nothing to press or tab to, as `KpiTiles`'s: nobody at a wall can use a control.
 */
export function StatusBar({ readOnly = false }: { readOnly?: boolean }) {
  const { health, connection, telemetry, drawing3d } = useSystemHealth();
  const alarmLoad = useAlarmLoad();
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
      <AlarmLoadSegment load={alarmLoad} readOnly={readOnly} />
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

const ALARM_WINDOW_MINUTES = ALARM_RATE_WINDOW_MS / 60_000;

/** One string, so the button's accessible name is one text node. A dash stands for a rate not known yet, never a 0. */
function alarmLoadText({ loaded, rate, flood }: AlarmLoad): string {
  if (flood.flooding) return `Alarm flood · ${flood.rate} / ${ALARM_WINDOW_MINUTES} min`;
  return `Alarms ${loaded ? rate : '—'} / ${ALARM_WINDOW_MINUTES} min`;
}

/**
 * The alarm load in the foot (V3-21.2, frame 16): "Alarms 3 / 10 min", or "Alarm flood · 14 / 10 min" with the warning glyph
 * and `data-state="warn"` while it lasts. A button on the console, for every role (reading the load is not an action on the
 * site); it has no popup attribute until V3-21.3 gives it a panel, since a button that announces a popup and opens none
 * misleads a screen reader. On the wall (`readOnly`) it is text: nothing there can be pressed or tabbed to.
 */
function AlarmLoadSegment({ load, readOnly }: { load: AlarmLoad; readOnly: boolean }) {
  const state = load.flood.flooding ? 'warn' : 'ok';
  const content = (
    <>
      <Icon glyph={alarmLoadIcon(load.flood.flooding)} size={14} />
      {alarmLoadText(load)}
    </>
  );
  if (readOnly) {
    return (
      <span className={styles.alarm} data-segment="alarms" data-state={state}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${styles.alarm} ${styles.alarmButton}`}
      data-segment="alarms"
      data-state={state}
    >
      {content}
    </button>
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
