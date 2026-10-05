import type { EventEmitter } from 'node:events';
import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, In, type QueryRunner } from 'typeorm';
import { runJob, runWithRequestId } from '../logging/request-context';
import { RealtimeMetrics } from '../metrics/realtime.metrics';
import { OUTBOX_CHANNEL, OutboxEvents } from './outbox-events';
import { OutboxEntity } from './outbox.entity';

const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
/** How much of a malformed payload is logged; any database session can send one. */
const LOGGED_PAYLOAD_MAX_CHARS = 200;

interface Notification {
  channel: string;
  payload?: string;
}

interface ListenConnection {
  runner: QueryRunner;
  /** The underlying `pg` client, which emits `notification`, `error` and `end`. */
  client: EventEmitter;
}

/**
 * Turns the relay's `NOTIFY`s into events on this process's bus, where `EventsGateway` broadcasts
 * them to the consoles connected here (ADR-0008). Every replica runs one, the writer included, so
 * every console sees every change whichever replica made it.
 *
 * A notification sent while this connection is down is lost, though the outbox row is not. After
 * reconnecting, the listener emits `OutboxEvents.Resynced` so the consoles here refetch.
 */
@Injectable()
export class OutboxListener implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxListener.name);
  private connection?: ListenConnection;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  /** Batches are delivered one at a time, in arrival order (which is commit order). */
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventEmitter2,
    private readonly metrics: RealtimeMetrics,
  ) {}

  /** Awaited, and Nest runs it before `app.listen()`: no console connects before this listens. */
  async onApplicationBootstrap(): Promise<void> {
    await this.listen();
  }

  /**
   * Whether this replica receives notifications now. False while reconnecting: consoles connected
   * here miss live events until it is back, so readiness reports it (ADR-0008).
   */
  isListening(): boolean {
    return this.connection !== undefined && !this.stopped;
  }

  /** Runs before TypeORM closes the pool, so the connection can be returned clean. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    await this.queue;
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) return;
    this.detach(connection.client);
    try {
      // Otherwise the pooled connection would keep receiving notifications for nobody.
      await connection.runner.query(`UNLISTEN ${OUTBOX_CHANNEL}`);
    } catch {
      // The connection is already broken; releasing it below drops it from the pool.
    } finally {
      await connection.runner.release();
    }
  }

  private async listen(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    let client: EventEmitter | undefined;
    try {
      client = (await runner.connect()) as EventEmitter;
      client.on('notification', this.onNotification);
      client.on('error', this.onConnectionLost);
      client.on('end', this.onConnectionLost);
      await runner.query(`LISTEN ${OUTBOX_CHANNEL}`);
      this.connection = { runner, client };
    } catch (error) {
      if (client) this.detach(client);
      await runner.release();
      throw error;
    }
  }

  private detach(client: EventEmitter): void {
    client.off('notification', this.onNotification);
    client.off('error', this.onConnectionLost);
    client.off('end', this.onConnectionLost);
  }

  private readonly onNotification = (notification: Notification): void => {
    if (this.stopped || notification.channel !== OUTBOX_CHANNEL) return;
    const ids = parseIds(notification.payload);
    if (!ids) {
      this.logger.warn(
        `Ignoring malformed ${OUTBOX_CHANNEL} payload: ${describePayload(notification.payload)}`,
      );
      return;
    }
    this.queue = this.queue.then(() => this.deliver(ids));
  };

  /** Never rejects, so one failed batch does not stall the queue behind it. */
  private async deliver(ids: string[]): Promise<void> {
    try {
      const rows = await this.dataSource.getRepository(OutboxEntity).find({
        select: { id: true, event: true, payload: true, requestId: true, createdAt: true },
        where: { id: In(ids) },
        order: { id: 'ASC' },
      });
      if (rows.length < ids.length) {
        this.logger.warn(`${ids.length - rows.length} notified outbox row(s) no longer exist`);
      }
      for (const row of rows) this.emit(row);
    } catch (error) {
      // These events are lost on this replica only; consoles here converge on their next refetch.
      this.logger.error(
        `Outbox delivery failed for ids ${ids.join(',')}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private emit(row: OutboxEntity): void {
    // Under the id of the request or job that wrote the row, so the broadcast logs on every
    // replica share it (ADR-0014). Rows from before the column existed get an id of their own.
    if (row.requestId) runWithRequestId(row.requestId, () => this.emitNow(row));
    else runJob(() => this.emitNow(row));
  }

  private emitNow(row: OutboxEntity): void {
    try {
      this.events.emit(row.event, row.payload);
      // Commit to broadcast on this replica, the real-time quality goal (ADR-0015).
      this.metrics.observeDelivery(row.event, row.createdAt);
    } catch (error) {
      // A failing listener must not hold back later events (ADR-0007). `@OnEvent` listeners
      // already log their own errors by default.
      this.logger.error(
        `Listener failed on ${row.event} (outbox ${row.id}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private readonly onConnectionLost = (error?: Error): void => {
    const connection = this.connection;
    if (!connection) return; // `error` and `end` both fire for one loss
    this.connection = undefined;
    this.detach(connection.client);
    void connection.runner.release();
    if (this.stopped) return;
    this.logger.warn(`Outbox listener lost its connection: ${error?.message ?? 'closed'}`);
    this.scheduleReconnect();
  };

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => void this.reconnect(), delay);
  }

  private async reconnect(): Promise<void> {
    this.reconnectTimer = undefined;
    if (this.stopped) return;
    try {
      await this.listen();
    } catch (error) {
      this.logger.warn(`Outbox listener reconnect failed: ${(error as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    this.logger.log('Outbox listener reconnected; asking consoles to resync');
    this.events.emit(OutboxEvents.Resynced);
  }
}

/** The relay sends a JSON array of id strings. Anything else on the channel is not ours. */
function parseIds(payload: string | undefined): string[] | undefined {
  try {
    const value: unknown = JSON.parse(payload ?? '');
    const valid =
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((id) => typeof id === 'string' && /^\d+$/.test(id));
    return valid ? (value as string[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A payload as one quoted, escaped log fragment, cut to `LOGGED_PAYLOAD_MAX_CHARS`: a newline or
 * control character in it cannot start a forged log line, and a huge one cannot flood the log.
 */
function describePayload(payload: string | undefined): string {
  if (payload === undefined) return '(none)';
  const shown = JSON.stringify(payload.slice(0, LOGGED_PAYLOAD_MAX_CHARS));
  return payload.length > LOGGED_PAYLOAD_MAX_CHARS ? `${shown}… (${payload.length} chars)` : shown;
}
