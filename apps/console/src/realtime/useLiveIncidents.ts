import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type EventsHandshakeAuth,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
} from '@occ/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { upsertIncident } from '../lib/incidents';
import { useConsole } from '../store';

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
 */
export function useLiveIncidents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setConnection, markFresh } = useConsole.getState();
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
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, incident),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.incident(incident.id),
        exact: true,
      });
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
      retryDelay = RETRY_FIRST_MS;
      if (refetchOnConnect) void queryClient.invalidateQueries({ queryKey: queryKeys.incidents });
      refetchOnConnect = true;
    });
    socket.on('disconnect', () => setConnection('offline'));
    socket.io.on('reconnect_attempt', () => setConnection('connecting'));
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
    });
    socket.on(IncidentEvents.Updated, apply);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket.disconnect();
    };
  }, [queryClient]);
}
