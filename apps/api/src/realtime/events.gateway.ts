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

/**
 * Broadcasts domain events to connected consoles (ADR-0003).
 * It only listens — services never call it directly.
 */
@WebSocketGateway({ namespace: EVENTS_NAMESPACE })
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
}
