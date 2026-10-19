import type { Asset, Zone } from '@occ/contracts';
import { placeLabel } from './assets';

/*
 * The words of the asset link on a telemetry incident's sheet (frame 10 `.asset-link`, V2-11.3): the
 * asset, then the part the rule watches and where the asset stands. Pure, so the sheet and its spec
 * say the same thing. The part's label is the model's (`partRows`, V2-14.10) and is handed in by the
 * caller, so the link and the inspector's Parts list cannot disagree; a class without a model, or one
 * whose model is not read yet, has no part and the line is the place alone.
 */

export interface AssetLinkLines {
  /** "CT-01 · Cooling tower 1". */
  heading: string;
  /** "Part: fan motor · Data Center roof", the place alone, or `null` when there is neither. */
  detail: string | null;
}

/** Frame 10 writes the part in running text ("Part: fan motor"); the inspector keeps the model's wording. */
const lowerFirst = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * `partLabel` is the label of the part bound to the point the rule watches (the evidence's key), when
 * the caller found one; the first part bound to that key is the one it names.
 */
export function assetLinkLines(
  asset: Pick<Asset, 'code' | 'name' | 'elevationM'>,
  zone: Pick<Zone, 'name' | 'kind' | 'heightM'> | undefined,
  partLabel?: string,
): AssetLinkLines {
  const detail = [partLabel ? `Part: ${lowerFirst(partLabel)}` : null, placeLabel(asset, zone)]
    .filter((piece) => piece !== null)
    .join(' · ');
  return { heading: `${asset.code} · ${asset.name}`, detail: detail === '' ? null : detail };
}
