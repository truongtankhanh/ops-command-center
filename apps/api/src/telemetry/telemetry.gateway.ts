import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  TELEMETRY_NAMESPACE,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryServerToClientEvents,
  type TelemetryWatchAck,
} from '@occ/contracts';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { Public } from '../auth/auth.decorators';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import { TELEMETRY_WATCH_RATE_LIMIT } from '../rate-limit/rate-limits';
import { type RealtimeSocketData, SocketAuth } from '../realtime/socket-auth';
import { FrameBaselines } from './frame-baselines';
import { SlidingWindowLimiter } from './sliding-window-limiter';
import { TelemetryIngestService } from './telemetry-ingest.service';
import type { Unsubscribe } from './telemetry-source';
import { readWatchCodes } from './watch-request';

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

/** The frames' cadence: one tick per 100 ms is the 10 Hz ceiling per watched asset (ADR-0019). */
const FRAME_INTERVAL_MS = 100;

/**
 * A watched asset is a Socket.IO room named `asset:<code>` (ADR-0019). Every socket is also in a
 * room named by its own id, so a room is told apart by this prefix.
 */
const ASSET_ROOM_PREFIX = 'asset:';

const roomOf = (assetCode: string): string => `${ASSET_ROOM_PREFIX}${assetCode}`;

function codeOf(room: string): string | undefined {
  return room.startsWith(ASSET_ROOM_PREFIX) ? room.slice(ASSET_ROOM_PREFIX.length) : undefined;
}

/** The asset codes a socket is watching, read back from its rooms rather than stored twice. */
function watchedBy(client: Pick<TelemetrySocket, 'rooms'>): Set<string> {
  const codes = new Set<string>();
  for (const room of client.rooms) {
    const code = codeOf(room);
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

/**
 * Serves the latest telemetry to the consoles connected to this replica (ADR-0019). It only reads
 * what `TelemetryIngestService` holds: it never writes, queries or computes, and it does not
 * coordinate with other replicas, so two consoles on two replicas can briefly differ by one reading.
 *
 * Delivery is best-effort and latest-wins, unlike `/events`:
 * - `telemetry.overview` and `telemetry.frame` are **volatile** emits. A socket whose transport is
 *   not writable skips them instead of queueing them (Socket.IO drops a volatile packet at
 *   `writeToEngine`), so a slow console cannot make this process buffer, and the next one
 *   corrects it.
 * - `telemetry.snapshot` and `telemetry.status` are plain emits: always delivered.
 *
 * The one message a console may send is `telemetry.watch`: the few assets it wants every reading
 * of, up to 10 times a second.
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
  private frameTimer?: NodeJS.Timeout;
  private unsubscribeUpstream?: Unsubscribe;
  private overviewFailureReported = false;
  private frameFailureReported = false;

  /** This task's own cursor into the ingest service: other readers keep theirs (V2-06.9). */
  private frameCursor = 0;
  private readonly baselines = new FrameBaselines();
  /** Keyed by the socket, so a closed socket's limiter goes with it: nothing to release. */
  private readonly limiters = new WeakMap<object, SlidingWindowLimiter>();

  @WebSocketServer()
  server: TelemetryNamespace;

  constructor(
    private readonly socketAuth: SocketAuth,
    private readonly ingest: TelemetryIngestService,
    private readonly metrics: TelemetryMetrics,
  ) {}

  /**
   * Nest guards never see the handshake (they wrap message handlers), so authentication is
   * namespace middleware, as for `/events`. A refused client gets `connect_error` with one of
   * `EventsConnectErrors` and never connects. `handleWatch` is the one handler, and it opts out of
   * the global guards because of this handshake.
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

    // One timer per cadence for the namespace, not one per socket: the payload of an overview is
    // the same for every console, and a frame is the same for every socket in its room, so each
    // is built and encoded once per tick. `unref()`: neither alone may keep the process alive, in
    // a spec or at shutdown.
    this.overviewTimer = setInterval(() => this.broadcastOverview(server), OVERVIEW_INTERVAL_MS);
    this.overviewTimer.unref();
    this.frameTimer = setInterval(() => this.broadcastFrames(server), FRAME_INTERVAL_MS);
    this.frameTimer.unref();
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

  /**
   * `telemetry.watch`: replaces the set of assets this socket wants frames of (ADR-0019). Always
   * answers, because the adapter acknowledges only a non-empty return value; it never throws for
   * what a client sent, which is read as `unknown`.
   *
   * `@Public()`: the global guards refuse every non-HTTP context, and this socket was
   * authenticated and role-checked in its handshake, with the transport closed when its token
   * expires. Reading is not acting, so any known role may watch. A handler added to this gateway
   * later is still refused until it opts in on its own.
   *
   * `@SkipThrottle()`: `ThrottlerGuard` does run for a socket message, but has nothing to key on
   * (every socket would share one counter and each message would write a row). The limit that
   * applies is `TELEMETRY_WATCH_RATE_LIMIT`, counted below.
   */
  @Public()
  @SkipThrottle()
  @SubscribeMessage(TelemetryEvents.Watch)
  async handleWatch(
    @ConnectedSocket() client: TelemetrySocket,
    @MessageBody() payload: unknown,
  ): Promise<TelemetryWatchAck> {
    // Past the limit a call changes nothing: the previous set keeps streaming, and the empty ack
    // is the one an all-unknown list gets too. The limit bounds a misbehaving client, not a
    // console that debounces its set.
    if (!this.limiterOf(client).tryTake(Date.now())) return { accepted: [] };

    const accepted = readWatchCodes(payload, (code) => this.ingest.knows(code));
    const previous = watchedBy(client);
    const wanted = new Set(accepted);

    // Rooms change before the first `await`: two messages read in one turn must not both start
    // from a stale `previous`. The in-memory adapter applies a join or leave at once.
    const pending: Array<ReturnType<TelemetrySocket['leave']>> = [];
    for (const code of previous) {
      if (!wanted.has(code)) pending.push(client.leave(roomOf(code)));
    }
    const joined = accepted.filter((code) => !previous.has(code));
    if (joined.length > 0) {
      // Asked before the join: a room with nobody in it has a baseline that is at best one tick
      // from being dropped, and is not what this socket is about to be told.
      const firstWatcher = new Set(
        joined.filter((code) => !this.server.adapter.rooms.get(roomOf(code))?.size),
      );
      pending.push(client.join(joined.map(roomOf)));
      // The snapshot is what the socket now holds, so it is also what the room is taken to have
      // been sent: the first frame is then the first change, not a repeat. A room that already has
      // watchers keeps its baseline, which is what they were last sent.
      const assets = this.ingest.snapshotOf(joined);
      for (const code of joined) {
        if (firstWatcher.has(code) || !this.baselines.has(code)) {
          this.baselines.seed(code, assets[code]?.values ?? {});
        }
      }
      // Plain emit, sent even when empty (as on connect), and ahead of the acknowledgement.
      client.emit(TelemetryEvents.Snapshot, { at: new Date().toISOString(), assets });
    }
    await Promise.all(pending);
    return { accepted };
  }

  /** Runs before `beforeApplicationShutdown`, so nothing is emitted into a closing server. */
  onModuleDestroy(): void {
    clearInterval(this.overviewTimer);
    this.overviewTimer = undefined;
    clearInterval(this.frameTimer);
    this.frameTimer = undefined;
    this.baselines.clear();
    this.unsubscribeUpstream?.();
    this.unsubscribeUpstream = undefined;
  }

  private limiterOf(client: TelemetrySocket): SlidingWindowLimiter {
    let limiter = this.limiters.get(client);
    if (!limiter) {
      limiter = new SlidingWindowLimiter(TELEMETRY_WATCH_RATE_LIMIT);
      this.limiters.set(client, limiter);
    }
    return limiter;
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

  /**
   * One tick of frames for every watched asset. The watched assets are the `asset:` rooms the
   * adapter holds: Socket.IO deletes a room when its last member leaves, so there is no count of
   * watchers here to drift, and a baseline outlives its room by at most one tick.
   *
   * With nothing watched this returns before reading the ingest service, and the cursor stays where
   * it was. That is harmless: a baseline is seeded from the snapshot when a watch starts, so what
   * an old cursor re-lists is already in it and produces no frame.
   */
  private broadcastFrames(server: TelemetryNamespace): void {
    // An exception in a timer callback is uncaught and would take the process down.
    try {
      const watched = new Set<string>();
      for (const room of server.adapter.rooms.keys()) {
        const code = codeOf(room);
        if (code !== undefined) watched.add(code);
      }
      this.baselines.retain(watched);
      if (watched.size === 0) return;

      // One scan for every room: it reads every held key, so it is not done per socket.
      const { version, changes } = this.ingest.changedSince(this.frameCursor);
      this.frameCursor = version;
      for (const change of changes) {
        if (!watched.has(change.assetCode)) continue;
        // `changedSince` lists the keys that arrived; a frame carries the ones that differ.
        const values = this.baselines.diff(change.assetCode, change.values);
        if (!values) continue;
        // `at` and `receivedAt` are the change's: the newest among the keys that arrived, so
        // never older than what this frame holds.
        server.to(roomOf(change.assetCode)).volatile.emit(TelemetryEvents.Frame, {
          assetCode: change.assetCode,
          at: change.at,
          receivedAt: change.receivedAt,
          values,
        });
      }
    } catch (error) {
      if (this.frameFailureReported) return;
      this.frameFailureReported = true;
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Telemetry frames failed; later failures are not logged: ${reason}`);
    }
  }
}
