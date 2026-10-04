import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
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
import type { Namespace, Socket } from 'socket.io';
import { OutboxEvents } from '../outbox/outbox-events';

/**
 * Broadcasts domain events to the consoles connected to this replica (ADR-0003); every replica
 * receives every event through its `OutboxListener` (ADR-0008). It only listens — services never
 * call it directly. WebSocket transport only: long-polling needs sticky sessions, and replicas
 * sit behind a round-robin proxy.
 */
@WebSocketGateway({ namespace: EVENTS_NAMESPACE, transports: ['websocket'] })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Namespace<ClientToServerEvents, ServerToClientEvents>;

  handleConnection(client: Socket): void {
    this.logger.debug(`Console connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
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
