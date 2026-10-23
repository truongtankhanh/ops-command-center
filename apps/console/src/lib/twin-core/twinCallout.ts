import type { TelemetryPoint, TelemetryRule, TelemetryValue } from '@occ/contracts';
import { type PartRow, sentenceCase } from './modelParts';
import { limitLine, readingParts } from '../assets/readings';
import { formatAgeCoarse } from '../telemetry/telemetryAge';

/*
 * What the 3D view's part callout says (V2-15.10, frames 03, 08 and 17, ADR-0020 "Settled in V2-15.1" and
 * "V2-15.10"), as plain data: no `three`, no store and no clock, so it tests without WebGL. The card
 * (`twin/TwinCallout.tsx`) only lays it out. The words are the Parts row's and the inspector's own
 * (`partText`, `formatReading`, `limitLine`), so the card, the list and the tooltip cannot say different things
 * about one reading (brief § Principle 1). Nothing else is on the card: no "Blade pitch", "Next service",
 * "Rating", "Trips" or "Last operated" (the catalogue holds none), and no set point row.
 */

export interface CalloutInput {
  assetCode: string;
  /** The selected node's name in the model: the eyebrow's second half. */
  node: string;
  /**
   * The model's row for the node (`partRows`: its label and the point it follows), or `undefined` while the model's
   * node tree is on its way, when the label falls back to the node's name and nothing is known to be bound.
   */
  row: Pick<PartRow, 'label' | 'bind'> | undefined;
  /** The point the part follows; `undefined` while the asset's detail is on its way. */
  point: TelemetryPoint | undefined;
  /** The rule that watches that point, if one does. */
  rule: Pick<TelemetryRule, 'comparator' | 'limit'> | null;
  /** The latest value; `undefined` when nothing was received for the asset or the point. */
  value: TelemetryValue | undefined;
  /** The asset's reading is not live (`readingIsStale`): the value is remembered, not current. */
  stale: boolean;
  /** How old the reading is on the server's clock, or `null` when that is not known yet. */
  ageMs: number | null;
}

/** What the card shows. */
export interface Callout {
  /** "CT-01 · FanBlade": the asset and the node as the model names it. */
  eyebrow: string;
  /** What the operator reads: the binding's `extras.label`, else the node's name in sentence case. */
  label: string;
  /** The big value. `text` is a figure, a word ("Closed"), "static" or "—". */
  reading: {
    text: string;
    /** Set small beside a figure; `null` for a word, "static" and "—". */
    unit: string | null;
    /** The value is remembered, not live: the card says "last" before it, as the Parts row does. */
    last: boolean;
  };
  /** "Live", or "1 min old" while the reading is not live; `null` with no reading to date. */
  subline: string | null;
  /** "Limit 85 °C" or "Low at 20 %" when a rule watches the point; `null` otherwise, and for a boolean point. */
  limit: string | null;
}

const NO_READING = { text: '—', unit: null, last: false } as const;

/**
 * The callout of one part. A **static** part (a node of the model that binds nothing) reads "static", as its Parts row
 * does; a bound part with no reading yet reads "—"; a live one is its figure and unit, or its word; a stale one is the
 * same with `last` set, and its age in the subline, so a remembered value is never taken for a live one (the age is
 * `formatAgeCoarse`, two units at most: it does not change every second). With the model's tree or the asset's detail
 * still on its way nothing is known to be bound, so the part reads "—" under the node's own name.
 */
export function calloutOf({
  assetCode,
  node,
  row,
  point,
  rule,
  value,
  stale,
  ageMs,
}: CalloutInput): Callout {
  const eyebrow = `${assetCode} · ${node}`;
  const label = row?.label ?? sentenceCase(node);
  if (row !== undefined && row.bind === null) {
    return {
      eyebrow,
      label,
      reading: { text: 'static', unit: null, last: false },
      subline: null,
      limit: null,
    };
  }
  const limit = point !== undefined && rule !== null ? limitLine(rule, point) : null;
  if (point === undefined || value === undefined) {
    return { eyebrow, label, reading: NO_READING, subline: null, limit };
  }
  const { text, unit } = readingParts(point, value);
  const subline = stale ? (ageMs === null ? null : `${formatAgeCoarse(ageMs)} old`) : 'Live';
  return { eyebrow, label, reading: { text, unit, last: stale }, subline, limit };
}
