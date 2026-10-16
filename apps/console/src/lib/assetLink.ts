import type { Asset, Zone } from '@occ/contracts';
import { partsOf } from './assetParts';
import { placeLabel } from './assets';

/*
 * The words of the asset link on a telemetry incident's sheet (frame 10 `.asset-link`, V2-11.3): the
 * asset, then the part the rule watches and where the asset stands. Pure, so the sheet and its spec
 * say the same thing. The part comes from the console's temporary part table (`assetParts`, until
 * V2-14 reads it from the model), so a class without a row has no part and the line is the place alone.
 */

export interface AssetLinkLines {
  /** "CT-01 · Cooling tower 1". */
  heading: string;
  /** "Part: fan motor · Data Center roof", the place alone, or `null` when there is neither. */
  detail: string | null;
}

/** Frame 10 writes the part in running text ("Part: fan motor"); the inspector keeps the table's wording. */
const lowerFirst = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);

/**
 * `key` is the point the rule watches (the evidence's), so the part is known even when the rule
 * itself no longer matches. The first part bound to that key is named.
 */
export function assetLinkLines(
  asset: Pick<Asset, 'code' | 'name' | 'elevationM'> & { class: Pick<Asset['class'], 'code'> },
  zone: Pick<Zone, 'name' | 'kind' | 'heightM'> | undefined,
  key: string,
): AssetLinkLines {
  const part = partsOf(asset.class.code)?.find((spec) => spec.bind === key);
  const detail = [part ? `Part: ${lowerFirst(part.label)}` : null, placeLabel(asset, zone)]
    .filter((piece) => piece !== null)
    .join(' · ');
  return { heading: `${asset.code} · ${asset.name}`, detail: detail === '' ? null : detail };
}
