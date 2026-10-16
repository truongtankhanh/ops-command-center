import type {
  IncidentEvent,
  TelemetryComparator,
  TelemetryPoint,
  TelemetryRule,
  TelemetryValue,
} from '@occ/contracts';
import { formatReading, limitLine } from './readings';
import { formatReadingAge } from './telemetryAge';

/*
 * The console's reader of why a telemetry incident was raised (V2-11.1, ADR-0018 § Evaluation).
 * `Incident` names the asset (`assetId`) but not the rule; the only record is the note of the
 * incident's first `reported` timeline entry, written by the API's `formatRuleEvidence`
 * (`apps/api/src/telemetry/rules/rule-evidence.ts`):
 *
 *     motorTempC 92 > 85 for 60 s
 *
 * Open question 5 settled that the console parses that note and matches the asset's rules, with no
 * contract field. The format is therefore a coupling: this module accepts exactly that grammar and
 * nothing else, and its spec pins the same sample strings as the producer's, so a change on either
 * side fails a spec. Pure: no store, no clock, no request. It describes a decision the API made; it
 * never makes one (V2-11 principle: the console never decides an incident).
 */

/** What decided a breach, as the note records it. The producer's own shape, restated (ADR-0001). */
export interface RuleEvidence {
  key: string;
  /** The number the rule's state machine compared: a boolean point is already `1` or `0`. */
  value: number;
  comparator: TelemetryComparator;
  limit: number;
  /** Seconds the breach had to last: the rule's `forS`, not how long it actually lasted. */
  forS: number;
}

/** A decimal as JavaScript's `String(number)` writes it: `92`, `-3`, `0.5`, `1e-7`, `1e+21`. */
const NUMBER = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
/**
 * `{key} {value} {>|<} {limit} for {forS} s`, whole string. One expression with no nested
 * quantifier, so no input can make it backtrack badly; a point key is camelCase (`motorTempC`).
 */
const EVIDENCE = new RegExp(
  `^([A-Za-z][A-Za-z0-9_]*) (${NUMBER}) ([<>]) (${NUMBER}) for (\\d+) s$`,
);
/** A real note is a few dozen characters; a longer string is not evidence and is not worth scanning. */
const MAX_NOTE_LENGTH = 256;

/**
 * Reads the evidence out of a timeline note, or `null` for anything that is not exactly the
 * producer's format: an operator's own note, an empty one, text with a suffix, a format this build
 * does not know. Never throws, whatever the string.
 */
export function parseEvidence(note: string | null | undefined): RuleEvidence | null {
  if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) return null;
  const match = EVIDENCE.exec(note);
  if (match === null) return null;
  const [, key, rawValue, operator, rawLimit, rawDwell] = match;
  if (
    key === undefined ||
    rawValue === undefined ||
    rawLimit === undefined ||
    rawDwell === undefined
  ) {
    return null;
  }
  const value = Number(rawValue);
  const limit = Number(rawLimit);
  const forS = Number(rawDwell);
  // `1e999` is a number to the grammar and `Infinity` to JavaScript; the producer never writes
  // either, and `-0` reads the same as `0`, which the producer writes.
  if (!Number.isFinite(value) || !Number.isFinite(limit) || !Number.isSafeInteger(forS))
    return null;
  if (Object.is(value, -0) || Object.is(limit, -0)) return null;
  return { key, value, comparator: operator === '>' ? 'above' : 'below', limit, forS };
}

/**
 * The evidence of an incident from its timeline: the note of the **first** `reported` entry. An
 * operator's `acknowledged` or `resolved` note is never read as evidence, and an incident reported
 * by a person has a note that is free text (or none), which does not parse.
 */
export function evidenceOfTimeline(
  timeline: readonly Pick<IncidentEvent, 'kind' | 'note'>[],
): RuleEvidence | null {
  const reported = timeline.find((event) => event.kind === 'reported');
  return reported === undefined ? null : parseEvidence(reported.note);
}

type RuleShape = Pick<TelemetryRule, 'name' | 'key' | 'comparator' | 'limit' | 'clear' | 'forS'>;

/**
 * The asset's rule that raised the incident: the one with the evidence's `key`, `comparator`,
 * `limit` and `forS`, compared exactly (a tolerance could pick the wrong rule). Two rules can
 * share those, so a tie is broken by the incident's title, which the API writes as
 * `{rule name} — {asset name}`.
 *
 * `null` when no rule fits (the rule was edited or disabled after the incident, or the note is of
 * another build), and `null` when several fit and the title names none or more than one: a wrong
 * rule is worse than none, and the caller then describes the evidence alone.
 */
export function matchRule<R extends RuleShape>(
  evidence: RuleEvidence,
  rules: readonly R[],
  title: string,
): R | null {
  // An array filter, not a lookup by key: a key such as `constructor` is never read off a prototype.
  const fits = rules.filter(
    (rule) =>
      rule.key === evidence.key &&
      rule.comparator === evidence.comparator &&
      rule.limit === evidence.limit &&
      rule.forS === evidence.forS,
  );
  if (fits.length <= 1) return fits[0] ?? null;
  const named = fits.filter((rule) => title.startsWith(`${rule.name} — `));
  return named.length === 1 ? (named[0] ?? null) : null;
}

/** The words of one piece of evidence, each part for the place that shows it. */
export interface EvidenceDescription {
  /** The point's label: "Motor temperature" (the key when the point is unknown). */
  label: string;
  /** The reading that breached, with its unit or word: "92 °C", "Wet". */
  reading: string;
  /** The rule in words: "Rule Motor over-temperature · above 85 °C for 60 s" (no name without a match). */
  rule: string;
  /**
   * "Limit 85 °C · clears below 80 °C" or "Low at 20 % · clears above 25 %". `null` without a
   * matching rule (there is no `clear` to say) and for a boolean point, whose 0.5 is an encoding.
   */
  limit: string | null;
  /** The matched rule's name, or `null`. */
  ruleName: string | null;
}

type PointShape = Pick<TelemetryPoint, 'key' | 'label' | 'kind' | 'unit'>;

/** Up to this many seconds the dwell is written in seconds (frame 10: "60 s"); then as an age. */
const DWELL_SECONDS_MAX = 119;

/** " for 60 s", " for 2 min", " for 1 h", or nothing for a rule with no dwell. */
function dwell(forS: number): string {
  if (forS <= 0) return '';
  return forS <= DWELL_SECONDS_MAX ? ` for ${forS} s` : ` for ${formatReadingAge(forS * 1000)}`;
}

/**
 * The words for frame 10's block. `rule` is the match from `matchRule` (or `null`) and `point` the
 * asset's point of the evidence's key (or `undefined` when the console does not have it): both are
 * optional on purpose, so an evidence that cannot be matched is still described, from itself alone,
 * and never with a limit or a clear that the console cannot vouch for.
 */
export function describeEvidence(
  evidence: RuleEvidence,
  rule: RuleShape | null,
  point: PointShape | undefined,
): EvidenceDescription {
  const shape: PointShape = point ?? {
    key: evidence.key,
    label: evidence.key,
    kind: 'number',
    unit: null,
  };
  const boolean = shape.kind === 'boolean';
  // The producer writes a boolean as the 1 or 0 it compared, against 0.5: read it back as the
  // value the word table speaks of (`leakDetected` true → "Wet").
  const valueOf = (n: number): TelemetryValue => (boolean ? n > 0.5 : n);
  const reading = formatReading(shape, valueOf(evidence.value));

  const condition = boolean
    ? reading
    : `${evidence.comparator} ${formatReading(shape, evidence.limit)}`;
  const prefix = rule === null ? '' : `Rule ${rule.name} · `;

  let limit: string | null = null;
  if (rule !== null && !boolean) {
    const line = limitLine(rule, shape);
    if (line !== null) {
      const clears = rule.comparator === 'above' ? 'clears below' : 'clears above';
      limit = `${line} · ${clears} ${formatReading(shape, rule.clear)}`;
    }
  }

  return {
    label: shape.label,
    reading,
    rule: `${prefix}${condition}${dwell(evidence.forS)}`,
    limit,
    ruleName: rule?.name ?? null,
  };
}
