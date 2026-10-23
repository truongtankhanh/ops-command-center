/*
 * What the heat overlay can colour by, as plain data (V2-17.4, ADR-0020 "Settled in V2-17.1" and "V2-17.4"): the
 * "Colour by" picker lists these and the legend's title reads the name of the one in effect, so a measure is written
 * once. It imports nothing: the picker is main-chunk code (`components/ColourBy.tsx`, beside the layers control) and
 * the legend is lazy-chunk code (`twin/HeatLegend.tsx`), and both read it.
 *
 * There is one measure today, so the choice is not state: the picker marks `INDOOR_TEMPERATURE` as selected and
 * choosing it changes nothing. A second measure is not only another entry here. It needs a source rule and a scale of
 * its own (`humidityPct` was rejected because an air handler has no such point) and a store field for the choice;
 * the ADR calls that a data addition, not a redesign.
 */

/** One thing the overlay can colour a building by. */
export interface HeatMeasure {
  /** Stable key, never shown. */
  id: string;
  /** The words on the picker's button and option, and the start of the legend's title. */
  label: string;
}

/** The reading the overlay shows today: the mean of a building's fresh `indoorTempC` sources (`lib/twinHeat.ts`). */
export const INDOOR_TEMPERATURE: HeatMeasure = {
  id: 'indoor-temperature',
  label: 'Indoor temperature',
};

/** Every measure the picker offers, in order. */
export const HEAT_MEASURES: readonly HeatMeasure[] = [INDOOR_TEMPERATURE];
