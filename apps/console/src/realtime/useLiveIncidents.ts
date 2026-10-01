import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
} from '@occ/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { queryKeys } from '../api/queries';
import { upsertIncident } from '../lib/incidents';
import { useConsole } from '../store';

/**
 * Subscribes to live incident events and patches the query cache in place (ADR-0003).
 * On reconnect it refetches once, to pick up anything missed while offline.
 */
export function useLiveIncidents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setConnection, markFresh } = useConsole.getState();
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(EVENTS_NAMESPACE, {
      transports: ['websocket'],
    });

    const apply = (incident: Incident) => {
      queryClient.setQueryData<Incident[]>(queryKeys.incidents, (list) =>
        upsertIncident(list, incident),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.incident(incident.id),
        exact: true,
      });
    };

    let connectedBefore = false;
    socket.on('connect', () => {
      setConnection('live');
      if (connectedBefore) void queryClient.invalidateQueries({ queryKey: queryKeys.incidents });
      connectedBefore = true;
    });
    socket.on('disconnect', () => setConnection('offline'));
    socket.io.on('reconnect_attempt', () => setConnection('connecting'));

    socket.on(IncidentEvents.Created, (incident) => {
      apply(incident);
      markFresh(incident.id);
    });
    socket.on(IncidentEvents.Updated, apply);

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);
}
