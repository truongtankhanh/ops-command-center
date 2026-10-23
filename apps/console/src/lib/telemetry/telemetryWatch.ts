import { type Asset, type Incident, TELEMETRY_WATCH_LIMIT } from '@occ/contracts';
import { isActive } from '../incidents/incidents';

/**
 * What the console wants every reading of, by asset **code** (`CT-01`). Codes, not ids: an
 * incident carries its asset as an `assetId`, which `telemetry.watch` does not know, so whoever
 * holds the catalogue turns it into a code before it gets here (V2-08.5).
 */
export interface WatchInputs {
  /** The asset open in the inspector. */
  inspected: string | null;
  /** The asset of the open incident, when a telemetry rule raised it. */
  incident: string | null;
}

/**
 * The watch set: the inspected asset first, then the incident's, without repeats, at most `limit`.
 * Order is the server's preference order when there are more than it can take, so the asset the
 * operator is looking at is the last to be dropped. Hover does not watch: the tooltip's readings
 * are the headline values the overview already carries (V2-08.1).
 */
export function deriveWatchSet(
  { inspected, incident }: WatchInputs,
  limit: number = TELEMETRY_WATCH_LIMIT,
): string[] {
  const wanted = [inspected, incident].filter(
    (code): code is string => code !== null && code !== '',
  );
  return [...new Set(wanted)].slice(0, Math.max(0, limit));
}

/**
 * The asset code to watch for the open incident, or `null` when there is nothing to read live.
 * Only a telemetry incident that is still unresolved is watched: a person's or the simulator's
 * incident has no rule reading behind it, and a resolved one shows "Raised at …" from its evidence
 * alone (V2-11.2). `assetId` is an id and `telemetry.watch` takes a code, so the catalogue turns
 * one into the other (V2-08.5); an id the catalogue does not have (an asset deleted since) is `null`.
 */
export function incidentWatchCode(
  incident: Incident,
  assets: readonly Pick<Asset, 'id' | 'code'>[],
): string | null {
  if (incident.source !== 'telemetry' || !isActive(incident)) return null;
  if (!incident.assetId) return null;
  return assets.find((asset) => asset.id === incident.assetId)?.code ?? null;
}
