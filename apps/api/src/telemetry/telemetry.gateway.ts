import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  TELEMETRY_NAMESPACE,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryServerToClientEvents,
} from '@occ/contracts';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import { type RealtimeSocketData, SocketAuth } from '../realtime/socket-auth';
import { TelemetryIngestService } from './telemetry-ingest.service';
import type { Unsubscribe } from './telemetry-source';

type TelemetryNamespace = Namespace<
  TelemetryClientToServerEvents,
  TelemetryServerToClientEvents,
  DefaultEventsMap,
  RealtimeSocketData
>;
type TelemetrySocket = Socket<
  TelemetryClientToServerEvents,
  TelemetryServerToClientEvents,
  DefaultEventsMap,
  RealtimeSocketData
>;

/** The overview's cadence (ADR-0019: "every second"). */
const OVERVIEW_INTERVAL_MS = 1_000;

/**
 * Serves the latest telemetry to the consoles connected to this replica (ADR-0019). It only reads
 * what `TelemetryIngestService` holds: it never writes, queries or computes, and it does not
 * coordinate with other replicas, so two consoles on two replicas can briefly differ by one reading.
 *
 * Delivery is best-effort and latest-wins, unlike `/events`:
 * - `telemetry.overview` is a **volatile** emit. A socket whose transport is not writable skips it
 *   instead of queueing it (Socket.IO drops a volatile packet at `writeToEngine`), so a slow
 *   console cannot make this process buffer, and the next overview corrects it.
 * - `telemetry.snapshot` and `telemetry.status` are plain emits: always delivered.
 *
 * The handshake rules live in `SocketAuth`, shared with `/events`, so a security control cannot
 * drift between the two namespaces. This class adds none of its own.
 */
@WebSocketGateway({ namespace: TELEMETRY_NAMESPACE, transports: ['websocket'] })
export class TelemetryGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(TelemetryGateway.name);
  private overviewTimer?: NodeJS.Timeout;
  private unsubscribeUpstream?: Unsubscribe;
  private overviewFailureReported = false;

  @WebSocketServer()
  server: TelemetryNamespace;

  constructor(
    private readonly socketAuth: SocketAuth,
    private readonly ingest: TelemetryIngestService,
    private readonly metrics: TelemetryMetrics,
  ) {}

  /**
   * Nest guards never see the handshake (they wrap message handlers, and this namespace has none
   * yet), so authentication is namespace middleware, as for `/events`. A refused client gets
   * `connect_error` with one of `EventsConnectErrors` and never connects.
   */
  afterInit(server: TelemetryNamespace): void {
    // Sockets here have passed the handshake below: connected consoles, counted on scrape.
    this.metrics.trackConsoles(() => server.sockets.size);
    server.use((socket, next) => {
      this.socketAuth.authenticate(socket).then(
        () => next(),
        (error: Error) => next(error),
      );
    });

    // The ingest service logs each change once; this only forwards it. A console that connects
    // later is told the current state in `handleConnection`, so a change is never replayed.
    this.unsubscribeUpstream = this.ingest.onUpstream((state) =>
      server.emit(TelemetryEvents.Status, state),
    );

    // One timer for the namespace, not one per socket: the payload is the same for every console,
    // so it is built and encoded once per tick. `unref()`: it alone must not keep the process
    // alive, in a spec or at shutdown.
    this.overviewTimer = setInterval(() => this.broadcastOverview(server), OVERVIEW_INTERVAL_MS);
    this.overviewTimer.unref();
  }

  handleConnection(client: TelemetrySocket): void {
    this.socketAuth.closeAtExpiry(client);
    // An empty snapshot is still sent (`off`, or a database that is not seeded yet): "always
    // delivered" is what lets a console tell "nothing held" from "not here yet".
    client.emit(TelemetryEvents.Snapshot, {
      at: new Date().toISOString(),
      assets: this.ingest.latestState(),
    });
    client.emit(TelemetryEvents.Status, this.ingest.upstream());
    this.logger.debug(`Telemetry console connected: ${client.id} (${client.data.user.subject})`);
  }

  handleDisconnect(client: TelemetrySocket): void {
    this.socketAuth.clearExpiry(client);
    this.logger.debug(`Telemetry console disconnected: ${client.id}`);
  }

  /** Runs before `beforeApplicationShutdown`, so nothing is emitted into a closing server. */
  onModuleDestroy(): void {
    clearInterval(this.overviewTimer);
    this.overviewTimer = undefined;
    this.unsubscribeUpstream?.();
    this.unsubscribeUpstream = undefined;
  }

  /**
   * Sent while the upstream is `paused` too: what is held is still the latest known, `receivedAt`
   * says how old it is, and the pause itself reaches the console as `telemetry.status`.
   */
  private broadcastOverview(server: TelemetryNamespace): void {
    if (server.sockets.size === 0) return;
    // An exception in a timer callback is uncaught and would take the process down.
    try {
      server.volatile.emit(TelemetryEvents.Overview, {
        at: new Date().toISOString(),
        assets: this.ingest.overview(),
      });
    } catch (error) {
      // Once, like the source's listeners (ADR-0019: nothing here logs per tick).
      if (this.overviewFailureReported) return;
      this.overviewFailureReported = true;
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Telemetry overview failed; later failures are not logged: ${reason}`);
    }
  }
}
