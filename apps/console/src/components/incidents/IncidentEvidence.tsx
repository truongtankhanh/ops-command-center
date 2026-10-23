import type {
  Asset,
  AssetDetail,
  IncidentDetail as Detail,
  TelemetryPoint,
  TelemetryRule,
} from '@occ/contracts';
import { type ReactNode, useMemo } from 'react';
import { ApiRequestError } from '../api/client';
import { useAsset, useAssets, useModelParts, useZones } from '../api/queries';
import {
  drawnSeries,
  encodedLatest,
  freshnessText,
  overSeverity,
  readingIsStale,
  SPARKLINE_WINDOW_MS,
} from '../lib/assets/assetInspector';
import { assetLinkLines } from '../lib/assets/assetLink';
import { isActive } from '../lib/incidents/incidents';
import { partRows } from '../lib/twin-core/modelParts';
import { formatReading } from '../lib/assets/readings';
import {
  describeEvidence,
  type EvidenceDescription,
  evidenceOfTimeline,
  matchRule,
  type RuleEvidence,
} from '../lib/telemetry/telemetryEvidence';
import { ageMs, staleAfterMs } from '../lib/telemetry/telemetryFreshness';
import { showAssetIn3d } from '../lib/twin-core/twinFlight';
import { buildingFocusOf } from '../lib/twin-core/twinLevel';
import { useTwinCapability } from '../lib/twin-core/useTwinCapability';
import { useAssetSeries, useAssetState, useServerNow } from '../realtime/telemetryStore';
import { useConsole } from '../store';
import text from '../styles/text.module.css';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { assetClassIcon, Box } from '../ui/icons';
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
 *
 * The card ends with the way to the asset (V2-11.3, `AssetLink`), for every state in which the
 * catalogue has the asset: the link needs the catalogue entry, not the rules. It is not drawn for an
 * asset the catalogue lacks or the API says is gone (a 404), so it never leads to "no longer exists".
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

  // Built once and handed down: `LiveEvidence` renders every second, and an element that is the same
  // object as last time is not rendered again.
  const gone = error instanceof ApiRequestError && error.status === 404;
  const link =
    asset !== undefined && !gone ? (
      <AssetLink asset={asset} evidenceKey={evidence.key} points={detail?.points} />
    ) : null;

  if (detail === undefined) {
    // No asset to read: gone (not in the catalogue, or a 404) is a fact; anything else is a failure
    // the operator should know the missing lines come from.
    const failed =
      assets === undefined ||
      (error !== null && !(error instanceof ApiRequestError && error.status === 404));
    const bare = describeEvidence(evidence, null, undefined);
    return (
      <Section>
        <Card ruleName={null} condition={bare.rule} link={link}>
          <Reading label={bare.label} limit={null} value={<Raised reading={bare.reading} />} />
        </Card>
        {failed && (
          <p className={`${text.muted} ${styles.note}`}>Rule details could not be loaded.</p>
        )}
      </Section>
    );
  }

  return <LoadedEvidence incident={incident} evidence={evidence} detail={detail} link={link} />;
}

function LoadedEvidence({
  incident,
  evidence,
  detail,
  link,
}: {
  incident: Detail;
  evidence: RuleEvidence;
  detail: AssetDetail;
  link: ReactNode;
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
        <Card ruleName={description.ruleName} condition={condition} link={link}>
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
      link={link}
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
  link,
}: {
  incident: Detail;
  evidence: RuleEvidence;
  detail: AssetDetail;
  rule: TelemetryRule | null;
  point: TelemetryPoint;
  description: EvidenceDescription;
  condition: string;
  link: ReactNode;
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
      <Card ruleName={description.ruleName} condition={condition} link={link}>
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

/** Frame 10's `.evidence`: the rule line, the reading row, then the way to the asset. */
function Card({
  ruleName,
  condition,
  link,
  children,
}: {
  ruleName: string | null;
  condition: string;
  link: ReactNode;
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
      {link}
    </div>
  );
}

/**
 * Frame 10's `.asset-link` (V2-11.3): the asset, the part the rule watches and where it stands, and
 * the way to its inspector. The part is the first row of the model's parts list bound to the point the rule
 * watches (`partRows`, as the inspector's Parts section builds it, so the two cannot disagree); while the
 * model or the asset's detail is on its way, or if either could not be read, the line is the place alone.
 * Opening is reading, not acting, so every role has it. `selectAsset`
 * replaces this sheet with the inspector, and the inspector's "Incident raised by this asset" row
 * is the way back while the incident is unresolved. Focus moves on its own: this button goes with
 * the sheet, and the inspector's sheet takes focus when it is lost (`Sheet`).
 *
 * "Show in 3D" (V2-16.6) is beside it, for every role and wherever the twin is available, even from the 2D map (it
 * is the way in): it switches to the 3D view if needed and frames the asset, and **selects nothing**, so this sheet
 * stays open and the incident's beacon stays ringed (frame 10). The flight is asked for only once the view really is
 * 3D (`setView` does nothing where the twin cannot be drawn), and if the stage is still loading it waits for it
 * (`twinCommands.showAsset`, through `showAssetIn3d`, which `F` shares). It carries the `F` hint while single-key
 * shortcuts are on: with this incident selected `F` frames the same asset (V2-18.2). Its name puts the visible words
 * first, like "Open asset", so a voice command matches (WCAG 2.5.3).
 *
 * A `div` with a real button, not frame 10's button around a button, which is invalid markup and
 * two tab stops. The accessible name says which asset; it contains the visible words (WCAG 2.5.3).
 */
function AssetLink({
  asset,
  evidenceKey,
  points,
}: {
  asset: Asset;
  evidenceKey: string;
  /** The asset's points when its detail is loaded: the parent holds the query, so the link adds no observer. */
  points: readonly TelemetryPoint[] | undefined;
}) {
  const { data: zones } = useZones();
  const selectAsset = useConsole((s) => s.selectAsset);
  const keysOn = useConsole((s) => s.keyboardShortcuts);
  const canShow = useTwinCapability().available;
  const zone = zones?.find((candidate) => candidate.id === asset.zoneId);
  const { data: model } = useModelParts(asset.class.modelUrl);
  const partLabel = useMemo(
    () =>
      points && model
        ? partRows(model, points).find((row) => row.bind === evidenceKey)?.label
        : undefined,
    [points, model, evidenceKey],
  );
  const { heading, detail } = assetLinkLines(asset, zone, partLabel);
  const showIn3d = () => showAssetIn3d(asset.code);
  return (
    <div className={styles.assetLink}>
      <span className={styles.assetGlyph}>
        <Icon glyph={assetClassIcon(asset.class.code)} size={20} />
      </span>
      <span className={styles.assetText}>
        <b className={styles.assetName}>{heading}</b>
        {detail !== null && <small className={styles.assetDetail}>{detail}</small>}
      </span>
      <div className={styles.assetActions}>
        <Button
          size="sm"
          aria-label={`Open asset ${asset.code}`}
          onClick={() => selectAsset(asset.code, buildingFocusOf(asset, zones))}
        >
          Open asset
        </Button>
        {canShow && (
          <Button
            size="sm"
            icon={Box}
            shortcut={keysOn ? 'F' : undefined}
            aria-label={`Show in 3D ${asset.code}`}
            onClick={showIn3d}
          >
            Show in 3D
          </Button>
        )}
      </div>
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
