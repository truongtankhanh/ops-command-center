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
  type Incident,
  IncidentEvents,
  type ServerToClientEvents,
} from '@occ/contracts';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { RealtimeMetrics } from '../metrics/realtime.metrics';
import { OutboxEvents } from '../outbox/outbox-events';
import { type RealtimeSocketData, SocketAuth } from './socket-auth';

type EventsNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  RealtimeSocketData
>;
type EventsSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  RealtimeSocketData
>;

/**
 * Broadcasts domain events to the consoles connected to this replica (ADR-0003); every replica
 * receives every event through its `OutboxListener` (ADR-0008). It only listens — services never
 * call it directly. WebSocket transport only: long-polling needs sticky sessions, and replicas
 * sit behind a round-robin proxy. A console connects with an access token and is disconnected when
 * that token expires (ADR-0010). Any known role may listen; a user with none is refused (ADR-0011).
 * Those handshake rules live in `SocketAuth`, shared with `/telemetry` (ADR-0019).
 */
@WebSocketGateway({ namespace: EVENTS_NAMESPACE, transports: ['websocket'] })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: EventsNamespace;

  constructor(
    private readonly socketAuth: SocketAuth,
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
      this.socketAuth.authenticate(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });
  }

  handleConnection(client: EventsSocket): void {
    this.socketAuth.closeAtExpiry(client);
    this.logger.debug(`Console connected: ${client.id} (${client.data.user.subject})`);
  }

  handleDisconnect(client: EventsSocket): void {
    this.socketAuth.clearExpiry(client);
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
}
