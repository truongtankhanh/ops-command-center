import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type ClientToServerEvents,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type EventsHandshakeAuth,
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
} from '@occ/contracts';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import {
  IdentityProviderUnavailableError,
  InvalidTokenError,
  TokenVerifier,
  type VerifiedToken,
} from '../auth/token-verifier';
import { RealtimeMetrics } from '../metrics/realtime.metrics';
import { OutboxEvents } from '../outbox/outbox-events';

/** Set by the handshake middleware on every socket that is let in. */
type EventsSocketData = VerifiedToken;
type EventsNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  EventsSocketData
>;
type EventsSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  EventsSocketData
>;

/** `setTimeout` fires at once for longer delays; tokens never live that long anyway. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Broadcasts domain events to the consoles connected to this replica (ADR-0003); every replica
 * receives every event through its `OutboxListener` (ADR-0008). It only listens — services never
 * call it directly. WebSocket transport only: long-polling needs sticky sessions, and replicas
 * sit behind a round-robin proxy. A console connects with an access token and is disconnected when
 * that token expires (ADR-0010). Any known role may listen; a user with none is refused (ADR-0011).
 */
@WebSocketGateway({ namespace: EVENTS_NAMESPACE, transports: ['websocket'] })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  server: EventsNamespace;

  constructor(
    private readonly tokens: TokenVerifier,
    private readonly metrics: RealtimeMetrics,
  ) {}

  /**
   * Nest guards never see the handshake (they wrap message handlers, and this namespace has none),
   * so authentication is namespace middleware. A refused client gets `connect_error` with one of
   * `EventsConnectErrors` and never connects.
   */
  afterInit(server: EventsNamespace): void {
    // Sockets here have passed the handshake below: connected consoles, counted on scrape.
    this.metrics.trackConsoles(() => server.sockets.size);
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
  }

  handleConnection(client: EventsSocket): void {
    // Close the transport rather than `disconnect()`, as in `onOutboxResynced`: the client then
    // reconnects on its own, with a fresh token, and refetches once.
    const delay = Math.min(client.data.expiresAt.getTime() - Date.now(), MAX_TIMER_MS);
    const timer = setTimeout(() => client.conn.close(), Math.max(delay, 0));
    timer.unref();
    this.expiryTimers.set(client.id, timer);
    this.logger.debug(`Console connected: ${client.id} (${client.data.user.subject})`);
  }

  handleDisconnect(client: EventsSocket): void {
    clearTimeout(this.expiryTimers.get(client.id));
    this.expiryTimers.delete(client.id);
    this.logger.debug(`Console disconnected: ${client.id}`);
  }

  @OnEvent(IncidentEvents.Created)
  onIncidentCreated(incident: Incident): void {
    this.server.emit(IncidentEvents.Created, incident);
  }

  @OnEvent(IncidentEvents.Updated)
  onIncidentUpdated(incident: Incident): void {
    this.server.emit(IncidentEvents.Updated, incident);
  }

  /**
   * This replica may have missed events while its outbox listener was reconnecting. Closing the
   * transport makes each console reconnect and refetch once, which covers the gap. `disconnect()`
   * would not: socket.io-client does not retry after a server-side disconnect.
   */
  @OnEvent(OutboxEvents.Resynced)
  onOutboxResynced(): void {
    const sockets = [...this.server.sockets.values()];
    for (const socket of sockets) socket.conn.close();
    this.logger.warn(`Closed ${sockets.length} console connection(s) so they refetch`);
  }

  /** Rejects with the `Error` the client receives; its message is all the client sees. */
  private async authenticate(socket: EventsSocket): Promise<void> {
    const { token } = socket.handshake.auth as Partial<EventsHandshakeAuth>;
    if (typeof token !== 'string') throw new Error(EventsConnectErrors.Unauthorized);
    let verified: VerifiedToken;
    try {
      verified = await this.tokens.verify(token);
    } catch (error) {
      if (error instanceof InvalidTokenError) throw new Error(EventsConnectErrors.Unauthorized);
      if (error instanceof IdentityProviderUnavailableError) {
        throw new Error(EventsConnectErrors.IdentityProviderUnavailable);
      }
      // A bug, not a client problem: log it here, because no exception filter sees the handshake.
      this.logger.error('Handshake authentication failed', (error as Error)?.stack);
      throw new Error('Internal server error');
    }
    // The roles stay those of this token until it expires and the connection is closed.
    if (verified.user.roles.length === 0) throw new Error(EventsConnectErrors.Forbidden);
    socket.data = verified;
  }
}
