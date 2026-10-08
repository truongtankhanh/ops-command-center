import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type EventsHandshakeAuth,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
  type Zone,
} from '@occ/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { incidentToast } from '../lib/attention';
import { playCriticalCue } from '../lib/criticalCue';
import { upsertIncident } from '../lib/incidents';
import { useConsole } from '../store';
import { hasToast, showToast } from '../ui/toasts';

/** Retries after a refused handshake: from 1 s, doubling up to 30 s, with Socket.IO's ±50 % jitter. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * Subscribes to live incident events and patches the query cache in place (ADR-0003).
 * On reconnect it refetches once, to pick up anything missed while offline.
 *
 * The handshake carries the current access token (ADR-0010). Socket.IO reconnects by itself after
 * a dropped connection, including the server closing it when the token expires, but never after
 * the server refused the handshake: this hook retries those.
 *
 * A new incident is marked fresh, and a critical or high one is announced with a toast (plus the
 * sound for a critical one, when it is on). An incident that is no longer open stops being fresh.
 */
export function useLiveIncidents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setConnection, markAlive, markFresh, forgetFresh } = useConsole.getState();
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

    // A toast already keyed to it is the reporter's own "Reported …": no second toast, no sound.
    const announce = (incident: Incident) => {
      if (hasToast(incident.id)) return;
      const zones = queryClient.getQueryData<Zone[]>(queryKeys.zones);
      const zoneName = zones?.find((zone) => zone.id === incident.zoneId)?.name;
      const toast = incidentToast(incident, zoneName, () =>
        useConsole.getState().select(incident.id),
      );
      if (!toast) return;
      showToast(toast);
      if (incident.severity === 'critical' && useConsole.getState().criticalSound) {
        playCriticalCue();
      }
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
