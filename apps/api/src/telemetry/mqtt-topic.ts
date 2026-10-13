/**
 * What the MQTT source subscribes to: every site, every asset, any depth under it (ADR-0019). The
 * API's broker account may subscribe to exactly this and publish nothing, so it is the one filter.
 */
export const SUBSCRIPTION_FILTER = 'occ/+/asset/+/#';

/** Largest payload read, in bytes (ADR-0019). A larger one is reported with no values. */
export const MAX_PAYLOAD_BYTES = 4096;

export interface ParsedTopic {
  kind: 'telemetry' | 'status';
  siteCode: string;
  assetCode: string;
}

/**
 * `occ/{siteCode}/asset/{assetCode}/telemetry` or `.../status`. Anything else, including another
 * sub-topic under the asset that the `#` of the subscription also matches, is `undefined`: it is
 * not ours to read (ADR-0019).
 *
 * The asset code is not checked against a pattern here. A device chooses it, and the catalogue
 * lookup downstream is the one check that matters.
 */
export function parseTopic(topic: string): ParsedTopic | undefined {
  const levels = topic.split('/');
  if (levels.length !== 5) return undefined;

  const [root, siteCode, asset, assetCode, leaf] = levels;
  if (root !== 'occ' || asset !== 'asset' || !siteCode || !assetCode) return undefined;
  if (leaf !== 'telemetry' && leaf !== 'status') return undefined;
  return { kind: leaf, siteCode, assetCode };
}
