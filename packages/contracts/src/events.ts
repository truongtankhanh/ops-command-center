import type { Incident } from './domain';

/** Socket.IO namespace that streams live updates to clients. */
export const EVENTS_NAMESPACE = '/events';

export const IncidentEvents = {
  Created: 'incident.created',
  Updated: 'incident.updated',
} as const;

/**
 * Server → client event map. Used to type both the gateway and the client socket,
 * so renaming an event or changing a payload is a compile error on both sides.
 */
export interface ServerToClientEvents {
  [IncidentEvents.Created]: (incident: Incident) => void;
  [IncidentEvents.Updated]: (incident: Incident) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {}
