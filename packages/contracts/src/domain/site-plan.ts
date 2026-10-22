import type { LngLat } from './geo';

/**
 * Parts of a site plan drawn under the zones: the site `boundary`, `road`s, and `field` markings.
 * Building footprints and parking rows are not here — clients derive them from the zones.
 */
export const SITE_FEATURE_PARTS = ['boundary', 'road', 'field'] as const;
export type SiteFeaturePart = (typeof SITE_FEATURE_PARTS)[number];

/** A GeoJSON `Polygon` (closed rings, outer first) or `LineString`, in [lng, lat]. */
export type SiteGeometry =
  { type: 'Polygon'; coordinates: LngLat[][] } | { type: 'LineString'; coordinates: LngLat[] };

export interface SiteFeature {
  part: SiteFeaturePart;
  geometry: SiteGeometry;
}

/** Everything drawn under and between the zones of one site, in drawing order. */
export interface SitePlan {
  id: string;
  code: string;
  name: string;
  center: LngLat;
  features: SiteFeature[];
}
