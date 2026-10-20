import { INDOOR_TEMPERATURE } from '../lib/heatMeasures';
import { HEAT_DOMAIN } from '../lib/twinHeat';
import { levelOf, showsHeat } from '../lib/twinLevel';
import { useConsole } from '../store';
import styles from './HeatLegend.module.css';

const [LOW, HIGH] = HEAT_DOMAIN;

/** The scale's ends and its middle, from the domain itself: a changed domain cannot leave a legend that lies. */
const TICKS: readonly number[] = [LOW, (LOW + HIGH) / 2, HIGH];

/** "19 °C": a whole degree when it is one. The building's own label keeps its decimal (`tempText`). */
const tickText = (tempC: number): string => `${Number(tempC.toFixed(1))} °C`;

/**
 * What the heat colours mean (V2-17.4, frame 13 `.heat-legend`, ADR-0020 "Settled in V2-17.1" and "V2-17.4"): the
 * title, the ramp, the scale's ticks and a note, shown over the stage while the overlay is drawn (the layer is on and
 * the level is the campus or a building, `showsHeat`). Bottom-left, above the marker legend: `TwinStage` stacks them,
 * because the marker legend still explains the beacons and the cameras, and at building level it holds the line that
 * says `Esc` returns to the campus.
 *
 * - **The ramp is a gradient, not six bands.** A shell's colour is continuous between the six `--heat-*` stops, evenly
 *   spaced along the scale, so a gradient over the same stops is exactly what a building at 23 °C (the middle tick)
 *   looks like; six blocks would put that tick on the border of two of them. The ramp is decoration (`aria-hidden`):
 *   lightness carries the value and the numbers are in words around it.
 * - **A reading, not a severity.** The note says so, says a faded building's sensor is silent, and says where the same
 *   numbers are as text: the Assets tab, because the canvas is hidden from assistive technology. It is a `note`, not a
 *   live region, and it is not interactive: no toggle and no stored preference, so it takes no tab stop.
 * - The same for every role; it reads the layer and the level from the store and nothing else.
 */
export function HeatLegend() {
  const shown = useConsole((state) => state.layers.heat && showsHeat(levelOf(state)));
  if (!shown) return null;

  return (
    <div role="note" className={styles.legend}>
      <p className={styles.title}>{INDOOR_TEMPERATURE.label}, by building</p>
      <div className={styles.ramp} aria-hidden="true" />
      <div className={styles.scale}>
        {TICKS.map((tempC) => (
          <span key={tempC}>{tickText(tempC)}</span>
        ))}
      </div>
      <p className={styles.text}>
        A reading, not a severity. Every building reports one; a faded building&apos;s sensor is
        silent. The Assets tab lists each reading.
      </p>
    </div>
  );
}
