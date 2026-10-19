import type { Asset, Incident, IncidentDetail } from '@occ/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { queryKeys } from '../api/queries';
import { useTelemetryStore } from '../realtime/telemetryStore';
import { createTwinFeed, type TwinFeed } from '../realtime/twinFeed';

const NO_ASSETS: readonly Asset[] = [];
const NO_INCIDENTS: readonly Incident[] = [];

/**
 * Where the effect publishes the feed and render reads it, as an external store: publishing is a call on
 * this object, not a `setState` in the effect body, which would render twice for what is one resource.
 */
function createHolder() {
  let current: TwinFeed | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => current,
    publish(next: TwinFeed | null) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * The twin's feed for the stage's lifetime (V2-14.5): the layout, the latest targets and the per-asset flags the
 * render loop reads (`twinFeed.ts`). It is created in an effect once the telemetry client exists and disposed in
 * its cleanup, so React StrictMode's mount, cleanup, mount leaves one live feed, as `useTelemetry` does for the
 * client; a replaced client gets a new feed. `null` until there is one.
 *
 * It reads the assets and the incidents from the query cache (no request of its own) and refreshes the feed
 * whenever the cache changes for them, or for an incident's detail, so an alarm or a rule's point shows at once
 * instead of at the next tick. `invalidate` is the canvas's (`useThree`), which this hook's caller supplies;
 * the latest one is used without recreating the feed.
 *
 * Not mounted anywhere yet: the render loop that reads the feed is V2-14.8.
 */
export function useTwinFeed({ invalidate }: { invalidate: () => void }): TwinFeed | null {
  const client = useTelemetryStore((state) => state.client);
  const queryClient = useQueryClient();
  const [holder] = useState(createHolder);
  const feed = useSyncExternalStore(holder.subscribe, holder.getSnapshot);

  const latestInvalidate = useRef(invalidate);
  useEffect(() => {
    latestInvalidate.current = invalidate;
  });

  useEffect(() => {
    if (client === null) return;
    const created = createTwinFeed({
      client,
      getAssets: () => queryClient.getQueryData<Asset[]>(queryKeys.assets) ?? NO_ASSETS,
      getIncidents: () => queryClient.getQueryData<Incident[]>(queryKeys.incidents) ?? NO_INCIDENTS,
      getIncidentDetail: (id) => queryClient.getQueryData<IncidentDetail>(queryKeys.incident(id)),
      invalidate: () => latestInvalidate.current(),
    });
    holder.publish(created);
    return () => {
      created.dispose();
      holder.publish(null);
    };
  }, [client, queryClient, holder]);

  useEffect(() => {
    if (feed === null) return;
    // `['assets', code]` and `['incidents', id]` share their first element with the lists.
    return queryClient.getQueryCache().subscribe((event) => {
      const [scope] = event.query.queryKey;
      if (scope === queryKeys.assets[0] || scope === queryKeys.incidents[0]) feed.refresh();
    });
  }, [feed, queryClient]);

  return feed;
}
