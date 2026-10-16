import type {
  AssetDetail,
  IncidentDetail as Detail,
  TelemetryPoint,
  TelemetryRule,
} from '@occ/contracts';
import { type ReactNode, useMemo } from 'react';
import { ApiRequestError } from '../api/client';
import { useAsset, useAssets } from '../api/queries';
import {
  drawnSeries,
  encodedLatest,
  freshnessText,
  overSeverity,
  readingIsStale,
  SPARKLINE_WINDOW_MS,
} from '../lib/assetInspector';
import { isActive } from '../lib/incidents';
import { formatReading } from '../lib/readings';
import {
  describeEvidence,
  type EvidenceDescription,
  evidenceOfTimeline,
  matchRule,
  type RuleEvidence,
} from '../lib/telemetryEvidence';
import { ageMs, staleAfterMs } from '../lib/telemetryFreshness';
import { useAssetSeries, useAssetState, useServerNow } from '../realtime/telemetryStore';
import text from '../styles/text.module.css';
import { SheetSection } from '../ui/SheetSection';
import { Skeleton } from '../ui/Skeleton';
import { Sparkline } from '../ui/Sparkline';
import styles from './IncidentEvidence.module.css';

const TITLE = 'Why it was raised';
const BOOLEAN_RANGE = { min: 0, max: 1 } as const;

/**
 * "Why it was raised" on the sheet of an incident a telemetry rule opened (frame 10, V2-11.2): the
 * rule in words, its limit and clear level, and the reading that breached it, drawn live while the
 * incident is unresolved. The console only describes what the API decided (brief § Real-time data:
 * it never decides that something is an incident).
 *
 * The evidence is the note of the incident's first `reported` entry (`telemetryEvidence`). When it
 * does not read as evidence, nothing is drawn and no request is made: the note stays in the
 * timeline. The telemetry watch is not set here: `TelemetryWatchSet` owns it, and this only reads.
 *
 * A resolved incident has no live reading, only "Raised at 92 °C" from the evidence. An asset the
 * catalogue no longer has, or whose rules could not be loaded, is described from the evidence alone
 * and never with a limit or a clear level the console cannot vouch for.
 */
export function IncidentEvidence({ incident }: { incident: Detail }) {
  const evidence = evidenceOfTimeline(incident.timeline);
  if (evidence === null) return null;
  return <EvidenceBlock incident={incident} evidence={evidence} />;
}

function EvidenceBlock({ incident, evidence }: { incident: Detail; evidence: RuleEvidence }) {
  const { data: assets, isPending: cataloguePending } = useAssets();
  const asset = assets?.find((candidate) => candidate.id === incident.assetId);
  // Disabled without a code, so a missing asset never asks for one.
  const { data: detail, error, isPending: detailPending } = useAsset(asset?.code ?? null);

  if (cataloguePending || (asset !== undefined && detailPending)) return <EvidenceSkeleton />;

  if (detail === undefined) {
    // No asset to read: gone (not in the catalogue, or a 404) is a fact; anything else is a failure
    // the operator should know the missing lines come from.
    const failed =
      assets === undefined ||
      (error !== null && !(error instanceof ApiRequestError && error.status === 404));
    const bare = describeEvidence(evidence, null, undefined);
    return (
      <Section>
        <Card ruleName={null} condition={bare.rule}>
          <Reading label={bare.label} limit={null} value={<Raised reading={bare.reading} />} />
        </Card>
        {failed && (
          <p className={`${text.muted} ${styles.note}`}>Rule details could not be loaded.</p>
        )}
      </Section>
    );
  }

  return <LoadedEvidence incident={incident} evidence={evidence} detail={detail} />;
}

function LoadedEvidence({
  incident,
  evidence,
  detail,
}: {
  incident: Detail;
  evidence: RuleEvidence;
  detail: AssetDetail;
}) {
  const rule = matchRule(evidence, detail.rules, incident.title);
  const point = detail.points.find((candidate) => candidate.key === evidence.key);
  const description = describeEvidence(evidence, rule, point);
  // The rule's words without its name: the name is drawn apart (bold), the condition on the right.
  const condition = describeEvidence(evidence, null, point).rule;

  // Nothing live to read: the incident is over, or the evidence names a point the asset does not have.
  if (!isActive(incident) || point === undefined) {
    return (
      <Section>
        <Card ruleName={description.ruleName} condition={condition}>
          <Reading
            label={description.label}
            limit={description.limit}
            value={<Raised reading={description.reading} />}
          />
        </Card>
      </Section>
    );
  }

  return (
    <LiveEvidence
      incident={incident}
      evidence={evidence}
      detail={detail}
      rule={rule}
      point={point}
      description={description}
      condition={condition}
    />
  );
}

/**
 * The live half: it alone reads the telemetry store and the server clock, so the per-second render
 * stays in this block and does not reach the note, the timeline or the cameras around it. Reads one
 * key's series, like the inspector's row, not the asset's whole view.
 */
function LiveEvidence({
  incident,
  evidence,
  detail,
  rule,
  point,
  description,
  condition,
}: {
  incident: Detail;
  evidence: RuleEvidence;
  detail: AssetDetail;
  rule: TelemetryRule | null;
  point: TelemetryPoint;
  description: EvidenceDescription;
  condition: string;
}) {
  const entry = useAssetState(detail.code);
  const serverNow = useServerNow();
  const series = useAssetSeries(detail.code, point.key);

  const stale =
    entry !== undefined && readingIsStale(entry, staleAfterMs(detail.headline), serverNow);
  const value = entry?.values[point.key] ?? entry?.headline[point.key];
  const latest = encodedLatest(point, value);
  const live = !stale && serverNow !== null;
  // A number and a boolean have a series; an enum has none, and a kind from a newer API is the value only.
  const drawable = point.kind === 'number' || point.kind === 'boolean';
  const drawn = useMemo(
    () =>
      drawable && value !== undefined && serverNow !== null
        ? drawnSeries(series, latest, serverNow, live)
        : null,
    [drawable, value, serverNow, series, latest, live],
  );
  // Without the rule (edited or disabled since) the evidence still says where the limit was, and the
  // incident's own severity is the one the rule gave it when it was raised.
  const over = overSeverity(
    rule ?? { comparator: evidence.comparator, limit: evidence.limit, severity: incident.severity },
    latest,
  );
  const age = entry !== undefined && serverNow !== null ? ageMs(entry.receivedAt, serverNow) : null;
  const staleText = stale ? freshnessText(age, true) : null;

  const chip =
    entry === undefined ? undefined : (
      <span className={styles.freshness} data-stale={stale ? 'true' : undefined}>
        <span className={styles.dot} aria-hidden="true" />
        {stale ? 'Stale' : 'Live'}
      </span>
    );

  return (
    <Section aside={chip}>
      <Card ruleName={description.ruleName} condition={condition}>
        <Reading
          label={description.label}
          limit={description.limit}
          over={over}
          stale={stale}
          chart={
            drawn !== null && serverNow !== null ? (
              <Sparkline
                times={drawn.times}
                values={drawn.values}
                from={serverNow - SPARKLINE_WINDOW_MS}
                to={serverNow}
                // A boolean rule's 0.5 is an encoding, not a limit an operator reads (V2-09.1).
                limit={point.kind === 'number' ? (rule?.limit ?? evidence.limit) : null}
                range={
                  point.kind === 'boolean' ? BOOLEAN_RANGE : { min: point.min, max: point.max }
                }
                step={point.kind === 'boolean'}
                stale={stale}
                over={over}
              />
            ) : null
          }
          value={
            <>
              {value === undefined ? '—' : formatReading(point, value)}
              {over !== undefined && <span className={styles.hidden}>, over its limit</span>}
              {staleText !== null && <small className={styles.age}>{staleText}</small>}
            </>
          }
        />
      </Card>
    </Section>
  );
}

function Section({ aside, children }: { aside?: ReactNode; children: ReactNode }) {
  return (
    <SheetSection title={TITLE} aside={aside}>
      {children}
    </SheetSection>
  );
}

/** Frame 10's `.evidence`: the rule line, then the reading row. */
function Card({
  ruleName,
  condition,
  children,
}: {
  ruleName: string | null;
  condition: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.evidence}>
      <p className={styles.rule}>
        <span>
          Rule
          {ruleName !== null && (
            <>
              {' '}
              <b>{ruleName}</b>
            </>
          )}
        </span>
        <span>{condition}</span>
      </p>
      {children}
    </div>
  );
}

/** One reading row: label and limit line, the chart cell, the value (the inspector's `ReadingRow`). */
function Reading({
  label,
  limit,
  chart = null,
  value,
  over,
  stale = false,
}: {
  label: string;
  limit: string | null;
  chart?: ReactNode;
  value: ReactNode;
  over?: TelemetryRule['severity'];
  stale?: boolean;
}) {
  return (
    <div className={styles.row} data-stale={stale ? 'true' : undefined} data-severity={over}>
      <span className={styles.label}>
        <span className={styles.name}>{label}</span>
        {limit !== null && <span className={styles.limit}>{limit}</span>}
      </span>
      <span className={styles.chart}>{chart}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}

/** A resolved incident, or one with nothing live to read: what the evidence recorded, and no more. */
function Raised({ reading }: { reading: string }) {
  return <span className={styles.raised}>Raised at {reading}</span>;
}

/** Laid out like the loaded card, so nothing jumps when the asset arrives. */
function EvidenceSkeleton() {
  return (
    <Section>
      <div aria-busy="true">
        <p role="status" className={styles.hidden}>
          Loading evidence…
        </p>
        <Skeleton className={styles.skeletonCard} />
      </div>
    </Section>
  );
}
