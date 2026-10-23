import type { AssetDetail, TelemetryPoint } from '@occ/contracts';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';
import { assetQueryOptions } from '../api/queries';
import type { ModelClass } from '../lib/twin-core/twinLoadQueue';

/** A class's points by class code: what `bindingsFromNodes` needs to check a model's `extras` against. */
export type ClassPoints = Readonly<Record<string, readonly TelemetryPoint[]>>;

/**
 * Every point of each modelled class (V2-14.7). The asset list carries only the headline points; the full
 * list (kind, range, enum values) is in an asset's detail, so this asks for **one asset per class**, the
 * class's `representative`, through the query the inspector uses (`assetQueryOptions`): the same cache entry,
 * reference data kept for the shift, and no request for an asset that is already there. A class whose detail
 * has not arrived (or failed) is absent from the object; its model still draws, without bindings, until it does.
 *
 * It is a hook over TanStack Query, read by `TwinStage` and passed down: a query hook has no client inside
 * `<Canvas>`. The result is a plain object built in `combine`: TanStack shares an object structurally with the
 * last one when nothing in it changed (it does not for a `Map`), so its identity changes only when a class's
 * points do, and what depends on it is not recomputed on every render.
 */
export function useClassPoints(classes: readonly ModelClass[]): ClassPoints {
  const combine = useCallback(
    (results: UseQueryResult<AssetDetail>[]): ClassPoints => {
      const points: Record<string, readonly TelemetryPoint[]> = {};
      classes.forEach(({ code }, index) => {
        const detail = results[index]?.data;
        if (detail) points[code] = detail.points;
      });
      return points;
    },
    [classes],
  );
  return useQueries({
    queries: classes.map(({ representative }) => assetQueryOptions(representative)),
    combine,
  });
}
