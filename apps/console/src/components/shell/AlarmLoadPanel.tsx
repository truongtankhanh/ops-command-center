import { useId } from 'react';
import { useAssets, useZones } from '../../api/queries';
import { barGeometry, CHART_HEIGHT, CHART_WIDTH, chartLabel } from '../../lib/incidents/alarmChart';
import {
  ALARM_HISTORY_MS,
  ALARM_RATE_WINDOW_MS,
  NOISY_WINDOW_MS,
} from '../../lib/incidents/alarmLoad';
import type { AlarmLoad } from '../../lib/incidents/useAlarmLoad';
import { formatClockTime } from '../../lib/shared/time';
import { buildingFocusOf } from '../../lib/twin-core/twinLevel';
import { useConsole } from '../../store';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { alarmLoadIcon } from '../../ui/icons';
import { Skeleton } from '../../ui/Skeleton';
import styles from './AlarmLoadPanel.module.css';

const WINDOW_MINUTES = ALARM_RATE_WINDOW_MS / 60_000;
const HISTORY_HOURS = ALARM_HISTORY_MS / 3_600_000;
const NOISY_HOURS = NOISY_WINDOW_MS / 3_600_000;

/*
 * The Alarm load panel (V3-21.3, frame 16): what the status bar's number means. The four measures of the model (V3-21.1) as
 * text, and the 3-hour chart that draws the same incidents. It only reads: the one thing a row does is select an asset, as
 * every other link to an inspector does, so all four roles have it (the API authorises every change, there is none here).
 *
 * - **Every state is said.** Loading is a skeleton with one hidden "Loading …"; a failed list says so (the bar's dash does not);
 *   an empty 3 hours replaces the chart only, since the noisy devices look back 24 hours.
 * - **A lower bound is never drawn as exact.** When the cached list is as long as the request (`partial`), the note is shown
 *   in every state that shows a number. It does not say "the 200 most recent": a full page drops the oldest resolved Low
 *   incidents first, not simply the oldest (V3-21.1).
 * - **Flood is words and a glyph**, never colour alone and no glow. It is workload, not a fault, so the text stays the panel's.
 * - **Nothing only in the picture.** The rows give the rate, the standing count and the noisy devices; the 18 buckets are only
 *   in the chart, so its name carries the window and the peak (`chartLabel`).
 *
 * `close` is the popover's: a row that opens an inspector closes the panel first, so the open panel does not cover the stage
 * the inspector is for, and focus returns to the bar's button.
 */
export function AlarmLoadPanel({ load, close }: { load: AlarmLoad; close: () => void }) {
  return (
    <div className={styles.body} aria-busy={!load.loaded && !load.failed ? true : undefined}>
      {load.failed ? (
        <EmptyState>The incident list could not be loaded.</EmptyState>
      ) : !load.loaded ? (
        <PanelSkeleton />
      ) : (
        <>
          <Rate load={load} />
          <Standing load={load} />
          <Chart load={load} />
          <NoisyDevices load={load} close={close} />
          {load.partial && (
            <p className={styles.note}>
              The incident list is full, so these figures are at least what is shown.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <>
      <Skeleton className={styles.skeletonFigure} />
      <Skeleton className={styles.skeletonLine} />
      <Skeleton className={styles.skeletonChart} />
      <span className={styles.hidden}>Loading alarm load</span>
    </>
  );
}

/** The rate, and in a word whether it is a flood. `since` is set whenever `flooding` is (the model's union). */
function Rate({ load }: { load: AlarmLoad }) {
  const { flood, rate } = load;
  return (
    <div className={styles.measure}>
      <p className={styles.rate}>
        <b className={styles.figure}>{rate}</b>
        {` raised in ${WINDOW_MINUTES} min`}
      </p>
      {flood.flooding ? (
        <p className={styles.state} data-state="flood">
          <Icon glyph={alarmLoadIcon(true)} size={14} className={styles.floodGlyph} />
          {`Flood since ${formatClockTime(flood.since)}`}
        </p>
      ) : (
        <p className={styles.state} data-state="normal">
          Normal
        </p>
      )}
    </div>
  );
}

function Standing({ load }: { load: AlarmLoad }) {
  return (
    <div className={styles.measure}>
      <span className={styles.label}>Standing</span>
      <p className={styles.value}>
        <b className={styles.figure}>{load.standing}</b>
        {' open past their attention time'}
      </p>
    </div>
  );
}

/**
 * The raised-per-10-minutes bars. An image with a name, because the 18 buckets are in no row; the visible caption would only
 * read the same words twice, so it is hidden from assistive tech.
 */
function Chart({ load }: { load: AlarmLoad }) {
  const empty = load.buckets.every((count) => count === 0);
  return (
    <div className={styles.measure}>
      <span className={styles.label} aria-hidden="true">
        {`Raised per ${WINDOW_MINUTES} min · last ${HISTORY_HOURS} h`}
      </span>
      {empty ? (
        <p className={styles.empty}>{`Nothing raised in the last ${HISTORY_HOURS} hours.`}</p>
      ) : (
        <>
          <svg
            className={styles.chart}
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            role="img"
            aria-label={chartLabel(load.buckets, load.now)}
            focusable="false"
          >
            {barGeometry(load.buckets).map(
              (bar, index) =>
                bar.height > 0 && (
                  // The 18 slots are fixed positions in time, so the index is their identity.
                  <rect
                    key={index}
                    className={styles.bar}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                  />
                ),
            )}
            <line
              className={styles.baseline}
              x1={0}
              x2={CHART_WIDTH}
              y1={CHART_HEIGHT}
              y2={CHART_HEIGHT}
            />
          </svg>
          <div className={styles.axis} aria-hidden="true">
            <span>{`${HISTORY_HOURS} h ago`}</span>
            <span>now</span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The assets that raised the most incidents in 24 hours. Before the catalogue arrives the list is not "empty", it is not known
 * yet (`noisyKnown`), so a skeleton stands in and the panel never says "no noisy devices" too early.
 */
function NoisyDevices({ load, close }: { load: AlarmLoad; close: () => void }) {
  const { data: assets } = useAssets();
  const { data: zones } = useZones();
  const selectAsset = useConsole((s) => s.selectAsset);
  const labelId = useId();

  const rows = load.noisy.flatMap((row) => {
    const asset = assets?.find((candidate) => candidate.code === row.assetCode);
    return asset ? [{ row, asset }] : [];
  });

  return (
    <div className={styles.measure}>
      <span id={labelId} className={styles.label}>{`Noisy devices · last ${NOISY_HOURS} h`}</span>
      {!load.noisyKnown ? (
        <div aria-busy="true">
          <Skeleton className={styles.skeletonLine} />
          <span className={styles.hidden}>Loading noisy devices</span>
        </div>
      ) : rows.length === 0 ? (
        <p
          className={styles.empty}
        >{`No device raised an incident in the last ${NOISY_HOURS} hours.`}</p>
      ) : (
        <ul className={styles.noisy} aria-labelledby={labelId}>
          {rows.map(({ row, asset }) => (
            <li key={asset.code}>
              {/* The name is one string: the three visible parts are separate boxes, which a text query would read run together. */}
              <button
                type="button"
                className={styles.noisyRow}
                aria-label={`${row.assetCode}, ${row.name}, ${row.count} raised`}
                onClick={() => {
                  close();
                  selectAsset(asset.code, buildingFocusOf(asset, zones));
                }}
              >
                <span className={styles.code}>{row.assetCode}</span>
                <span className={styles.name}>{row.name}</span>
                <span className={styles.count}>{`${row.count} raised`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
