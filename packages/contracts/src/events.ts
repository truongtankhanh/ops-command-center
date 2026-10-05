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

/**
 * Handshake payload for `/events`: `io(url, { auth })`. A connection without a valid access token
 * is refused. Pass `auth` as a function, `(cb) => cb({ token })`, so every reconnect sends the
 * current token: the server closes a connection when its token expires, and the client reconnects.
 */
export interface EventsHandshakeAuth {
  token: string;
}

/** `connect_error` messages for a refused handshake, so a client can tell them apart. */
export const EventsConnectErrors = {
  /** No token, or one the API does not accept: sign in again. */
  Unauthorized: 'Unauthorized',
  /** The API cannot check tokens right now: retry, signing in again will not help. */
  IdentityProviderUnavailable: 'Identity provider unavailable',
  /** Signed in, but no role grants access: signing in again will not help. */
  Forbidden: 'Forbidden',
} as const;
