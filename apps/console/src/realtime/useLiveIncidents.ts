import {
  type Asset,
  type AssetDetail,
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type EventsHandshakeAuth,
  type Incident,
  type IncidentDetail,
  IncidentEvents,
  type ServerToClientEvents,
  type Zone,
} from '@occ/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { incidentQuery, queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { incidentToast, type IncidentToastContext } from '../lib/attention';
import { playCriticalCue } from '../lib/criticalCue';
import { upsertIncident } from '../lib/incidents';
import { evidenceOfTimeline, summariseEvidence } from '../lib/telemetryEvidence';
import { twinCommands } from '../lib/twinCommands';
import { useConsole } from '../store';
import { hasToast, showToast, updateToast } from '../ui/toasts';

/** Retries after a refused handshake: from 1 s, doubling up to 30 s, with Socket.IO's ±50 % jitter. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** "Fly to" on an incident's toast: select it, then ask for the flight (a no-op without a 3D stage). */
const flyTo = (incident: Incident, select: () => void) => () => {
  select();
  twinCommands.flyToIncident(incident.id);
};

/**
 * Subscribes to live incident events and patches the query cache in place (ADR-0003).
 * On reconnect it refetches once, to pick up anything missed while offline.
 *
 * The handshake carries the current access token (ADR-0010). Socket.IO reconnects by itself after
 * a dropped connection, including the server closing it when the token expires, but never after
 * the server refused the handshake: this hook retries those.
 *
 * A new incident is marked fresh, and a critical or high one is announced with a toast (plus the
 * sound for a critical one, when it is on); a critical one also shows the map's Incidents layer
 * again if it was hidden. An incident that is no longer open stops being fresh.
 *
 * The event carries an `Incident`, not its timeline, so the toast of an incident a telemetry rule
 * raised is shown at once with what is cached and gets the reading afterwards, from one fetch of
 * the incident's detail (V2-11.4): the same toast, with new words.
 *
 * In the 3D view, which is read once when the toast is made, the toast offers "Fly to" and "Open incident" instead of
 * "View incident" (V2-16.5). "Fly to" selects the incident and **then** asks the camera to fly to its beacon, so the
 * flight replaces any a change of level starts; it checks no view of its own: in 2D there is no rig, the command does
 * nothing and the selection is all that happens. Nothing here moves the camera when an incident arrives.
 */
export function useLiveIncidents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setConnection, markAlive, markFresh, forgetFresh, showLayer } = useConsole.getState();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(EVENTS_NAMESPACE, {
      transports: ['websocket'],
      // A function, so every reconnect sends the token that is current at that moment.
      auth: (send) => {
        void getAccessToken().then((token) =>
          send({ token: token ?? '' } satisfies EventsHandshakeAuth),
        );
      },
    });
    let disposed = false;
    let retryDelay = RETRY_FIRST_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = (incident: Incident) => {
      markAlive();
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, incident),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.incident(incident.id),
        exact: true,
      });
    };

    /** The zone and, for a telemetry incident, the asset, as the cache has them right now. */
    const contextOf = (incident: Incident): IncidentToastContext & { asset?: Asset } => {
      const zones = queryClient.getQueryData<Zone[]>(queryKeys.zones);
      const assets = queryClient.getQueryData<Asset[]>(queryKeys.assets);
      return {
        zone: zones?.find((zone) => zone.id === incident.zoneId),
        asset: incident.assetId
          ? assets?.find((asset) => asset.id === incident.assetId)
          : undefined,
      };
    };

    // A toast already keyed to it is the reporter's own "Reported …": no second toast, no sound.
    const announce = (incident: Incident) => {
      // A video wall screen has no toast region to show or clear one, and makes no sound (V2-21.2).
      if (useConsole.getState().wall !== null) return;
      if (hasToast(incident.id)) return;
      const onView = () => useConsole.getState().select(incident.id);
      const onFly = useConsole.getState().view === '3d' ? flyTo(incident, onView) : undefined;
      const toast = incidentToast(incident, contextOf(incident), onView, onFly);
      if (!toast) return;
      showToast(toast);
      if (incident.severity === 'critical' && useConsole.getState().criticalSound) {
        playCriticalCue();
      }
      if (incident.source === 'telemetry') void addReading(incident, onView, onFly);
    };

    // The reading is the rule's own note on the incident's first timeline entry. It changes words of
    // the toast already shown and nothing else: no second toast, no second sound, and the view does
    // not move (brief § Principle 4). Whatever goes wrong, the first toast stays as it is.
    const addReading = async (incident: Incident, onView: () => void, onFly?: () => void) => {
      let detail: IncidentDetail;
      try {
        detail = await queryClient.fetchQuery(incidentQuery(incident.id));
      } catch {
        return;
      }
      // Gone while waiting: the hook was torn down, or the operator sent the toast away.
      if (disposed || !hasToast(incident.id)) return;
      const evidence = evidenceOfTimeline(detail.timeline);
      if (evidence === null) return;

      // The catalogue and the zones may have loaded since the event: ask the cache again. The unit
      // is the asset's point; the cached detail has all of them, the catalogue its headline ones.
      const context = contextOf(incident);
      const points =
        (context.asset &&
          queryClient.getQueryData<AssetDetail>(queryKeys.asset(context.asset.code))?.points) ||
        context.asset?.headline;
      const point = points?.find((candidate) => candidate.key === evidence.key);
      const next = incidentToast(
        incident,
        { ...context, evidence: summariseEvidence(evidence, point) },
        onView,
        onFly,
      );
      if (next) updateToast(incident.id, { detail: next.detail });
    };

    const retryRefused = async (reason: string) => {
      // The API refused this token: renew it first. If that fails, the session banner takes over.
      // Other refusals are retried without renewing. For `Forbidden`, a new token would not bring
      // a role back sooner than the scheduled renewal, after which the session gate replaces the
      // console if the roles are gone (ADR-0011).
      if (reason === EventsConnectErrors.Unauthorized && !(await renewSession())) return;
      if (disposed) return;
      const delay = retryDelay * (0.5 + Math.random());
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      retryTimer = setTimeout(() => socket.connect(), delay);
    };

    // Refetch when events may have been missed: on every reconnect, and on the first connect after
    // a refusal (the list may have loaded over REST while the socket was being refused).
    let refetchOnConnect = false;
    socket.on('connect', () => {
      setConnection('live');
      markAlive();
      retryDelay = RETRY_FIRST_MS;
      if (refetchOnConnect) void queryClient.invalidateQueries({ queryKey: queryKeys.incidents });
      refetchOnConnect = true;
    });
    socket.on('disconnect', () => setConnection('offline'));
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    // The server's heartbeat proves the link is alive on a quiet shift with no incident events.
    socket.io.on('ping', () => markAlive());
    socket.on('connect_error', (error) => {
      // Still active: the transport failed, and Socket.IO is already retrying.
      if (socket.active) return;
      setConnection('offline');
      refetchOnConnect = true;
      void retryRefused(error.message);
    });

    socket.on(IncidentEvents.Created, (incident) => {
      apply(incident);
      markFresh(incident.id);
      // A layer toggle must not hide the one thing that cannot wait: a new critical incident
      // turns the Incidents layer back on (V2-10.2). An update, or one found by a reconnect's
      // refetch, does not: neither is "new".
      if (incident.severity === 'critical') showLayer('incidents');
      announce(incident);
    });
    socket.on(IncidentEvents.Updated, (incident) => {
      apply(incident);
      // Acknowledged or resolved, by anyone: someone is on it, so the row no longer stands out.
      if (incident.status !== 'open') forgetFresh(incident.id);
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket.disconnect();
    };
  }, [queryClient]);
}
