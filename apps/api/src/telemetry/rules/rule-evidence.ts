import type { TelemetryComparator } from '@occ/contracts';

/** What decided a breach: the reading, which side of the limit it passed, and how long it held. */
export interface RuleEvidence {
  key: string;
  /**
   * The number the state machine compared. A boolean point is already `1` or `0` here, so its
   * evidence reads `leakDetected 1 > 0.5 for 10 s` and not `true` (asset-classes.md, Booleans).
   */
  value: number;
  comparator: TelemetryComparator;
  limit: number;
  /** Seconds the breach had to last: the rule's `for_s`, not the time it actually lasted. */
  forS: number;
}

const OPERATORS: Record<TelemetryComparator, string> = { above: '>', below: '<' };

/**
 * The text of the `reported` timeline entry of a telemetry incident (ADR-0018, "Evaluation"):
 * `motorTempC 92 > 85 for 60 s`. One function, so the note an operator reads and the one a spec
 * pins cannot drift. It carries no unit on purpose: the console knows the point's unit and adds
 * it where it shows the evidence.
 */
export function formatRuleEvidence(evidence: RuleEvidence): string {
  const { key, value, comparator, limit, forS } = evidence;
  return `${key} ${value} ${OPERATORS[comparator]} ${limit} for ${forS} s`;
}
