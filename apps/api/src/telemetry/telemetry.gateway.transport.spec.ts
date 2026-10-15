import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Registry } from '@prometheus-io/client';
import {
  TELEMETRY_NAMESPACE,
  type TelemetryClientToServerEvents,
  TelemetryEvents,
  type TelemetryFrames,
  type TelemetryServerToClientEvents,
} from '@occ/contracts';
import { Server } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { TelemetryMetrics } from '../metrics/telemetry.metrics';
import type { SocketAuth } from '../realtime/socket-auth';
import { TelemetryGateway } from './telemetry.gateway';
import type { TelemetryChange, TelemetryIngestService } from './telemetry-ingest.service';

/**
 * The gateway over a real Socket.IO server and a real WebSocket client, with no database: the one
 * place the delivery rules of ADR-0019 are observed on a transport. `telemetry.gateway.spec.ts`
 * replaces the namespace with a fake whose emit is a mock, so it cannot see Socket.IO discard a
 * second volatile packet in one synchronous turn (V2-06.12, V2-08.2); this spec can.
 *
 * Ticks are driven by hand (`gateway['broadcastFrames']`, `gateway['onTick']`), so no case depends
 * on a timer; the timer itself is covered by the e2e suite and the unit spec's fake timers.
 */

type Namespace = Parameters<TelemetryGateway['afterInit']>[0];
type Client = ClientSocket<TelemetryServerToClientEvents, TelemetryClientToServerEvents>;

const AT = '2026-10-15T08:00:00.000Z';
const KNOWN = new Set(['CT-01', 'CT-02', 'CT-03']);

const change = (
  assetCode: string,
  values: Record<string, number | boolean | string>,
): TelemetryChange => ({ assetCode, assetId: `id-${assetCode}`, values, at: AT, receivedAt: AT });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await pause(5);
  }
}

/** What a client was sent that this spec cares about, in order of arrival. */
interface Received {
  frames: TelemetryFrames[];
  /** `'frames'` and `'overview'`, in the order they arrived. */
  order: string[];
}

describe('TelemetryGateway over a real transport', () => {
  const clients: Client[] = [];
  let http: ReturnType<typeof createServer>;
  let server: Server;
  let namespace: Namespace;
  let gateway: TelemetryGateway;
  /** What the fake ingest service lists as changed on the next read. */
  let changes: TelemetryChange[];

  beforeEach(async () => {
    changes = [];
    http = createServer();
    server = new Server(http, { transports: ['websocket'] });
    namespace = server.of(TELEMETRY_NAMESPACE) as unknown as Namespace;

    const ingest = {
      latestState: () => ({}),
      snapshotOf: () => ({}),
      overview: () => ({}),
      upstream: () => ({ upstream: 'live', since: AT }),
      onUpstream: () => () => undefined,
      knows: (code: string) => KNOWN.has(code),
      changedSince: (version: number) => ({ version: version + 1, changes }),
    };
    const auth = {
      authenticate: async (socket: { data: object }) => {
        Object.assign(socket.data, { user: { subject: 'user-1' } });
      },
      closeAtExpiry: () => undefined,
      clearExpiry: () => undefined,
    };
    gateway = new TelemetryGateway(
      auth as unknown as SocketAuth,
      ingest as unknown as TelemetryIngestService,
      new TelemetryMetrics(new Registry()),
    );
    jest.spyOn(gateway['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(gateway['logger'], 'debug').mockImplementation(() => undefined);
    gateway.server = namespace;
    gateway.afterInit(namespace);
    // Each tick is the test's to take: the gateway's own timer would race it.
    clearInterval(gateway['tickTimer']);

    // What the Nest adapter wires in the application: a connection and the one message.
    namespace.on('connection', (socket) => {
      gateway.handleConnection(socket);
      socket.on(TelemetryEvents.Watch, (payload, ack) => {
        void gateway.handleWatch(socket, payload).then(ack);
      });
      socket.on('disconnect', () => gateway.handleDisconnect(socket));
    });

    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    gateway.onModuleDestroy();
    await new Promise<void>((resolve) => void server.close(() => resolve()));
    jest.restoreAllMocks();
  });

  async function connect(): Promise<{ socket: Client; received: Received }> {
    const { port } = http.address() as AddressInfo;
    const socket: Client = io(`http://127.0.0.1:${port}${TELEMETRY_NAMESPACE}`, {
      transports: ['websocket'],
      reconnection: false,
    });
    clients.push(socket);
    const received: Received = { frames: [], order: [] };
    socket.on(TelemetryEvents.Frames, (batch) => {
      received.frames.push(batch);
      received.order.push('frames');
    });
    socket.on(TelemetryEvents.Overview, () => {
      received.order.push('overview');
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return { socket, received };
  }

  const watch = (socket: Client, assets: string[]) =>
    socket.timeout(2_000).emitWithAck(TelemetryEvents.Watch, { assets });

  const frameTick = () => gateway['broadcastFrames'](namespace);
  const tick = () => gateway['onTick'](namespace);
  const codesOf = (batch: TelemetryFrames | undefined) =>
    batch?.frames.map((frame) => frame.assetCode);

  it('delivers the frames of two watched assets that changed in the same tick', async () => {
    const { socket, received } = await connect();
    await watch(socket, ['CT-01', 'CT-02']);
    changes = [change('CT-01', { temp: 1 }), change('CT-02', { temp: 2 })];

    frameTick();
    await until(() => received.frames.length > 0, 'a telemetry.frames packet');
    await pause(50);

    // One packet holding both. A packet per asset would have delivered only the first.
    expect(received.frames).toHaveLength(1);
    expect(codesOf(received.frames[0])).toEqual(['CT-01', 'CT-02']);
  });

  it('gives each socket the frames of the assets it watches, not those of its neighbour', async () => {
    const both = await connect();
    const onlySecond = await connect();
    await watch(both.socket, ['CT-01', 'CT-02']);
    await watch(onlySecond.socket, ['CT-02']);
    changes = [change('CT-01', { temp: 1 }), change('CT-02', { temp: 2 })];

    frameTick();
    await until(
      () => both.received.frames.length > 0 && onlySecond.received.frames.length > 0,
      'a packet on each socket',
    );
    await pause(50);

    expect(codesOf(both.received.frames[0])).toEqual(['CT-01', 'CT-02']);
    expect(codesOf(onlySecond.received.frames[0])).toEqual(['CT-02']);
    expect(both.received.frames).toHaveLength(1);
    expect(onlySecond.received.frames).toHaveLength(1);
  });

  it('keeps the overview and the frames in separate ticks, and loses no frame to the overview', async () => {
    const { socket, received } = await connect();
    await watch(socket, ['CT-01']);

    // Nine ticks of frames: each waits for its packet, so the transport is writable again.
    for (let k = 1; k <= 9; k++) {
      changes = [change('CT-01', { temp: k })];
      tick();
      await until(() => received.frames.length === k, `the frames packet of tick ${k}`);
    }

    // The tenth tick is the overview's, and reads no changes: they wait for the next tick.
    changes = [change('CT-01', { temp: 10 })];
    tick();
    await until(() => received.order.includes('overview'), 'the overview');
    expect(received.frames).toHaveLength(9);

    tick();
    await until(() => received.frames.length === 10, 'the frames packet after the overview');

    expect(received.order).toEqual([
      ...Array.from({ length: 9 }, () => 'frames'),
      'overview',
      'frames',
    ]);
    expect(received.frames[9]?.frames[0]?.values).toEqual({ temp: 10 });
  });

  it('queues nothing for a socket whose transport is not writable, and sends the latest after', async () => {
    const { socket, received } = await connect();
    await watch(socket, ['CT-01']);
    const serverSocket = [...namespace.sockets.values()][0];
    expect(serverSocket).toBeDefined();
    const engine = serverSocket!.conn as unknown as {
      transport: { writable: boolean };
      writeBuffer: unknown[];
    };

    // The transport is still sending: a volatile packet is discarded, not buffered.
    engine.transport.writable = false;
    for (let temp = 1; temp <= 5; temp++) {
      changes = [change('CT-01', { temp })];
      frameTick();
    }
    await pause(50);

    expect(received.frames).toHaveLength(0);
    expect(engine.writeBuffer).toHaveLength(0);

    // Back to writable: the next tick delivers the latest value, not the five it missed.
    engine.transport.writable = true;
    changes = [change('CT-01', { temp: 6 })];
    frameTick();
    await until(() => received.frames.length > 0, 'the packet after the transport is writable');
    await pause(50);

    expect(received.frames).toHaveLength(1);
    expect(received.frames[0]?.frames[0]?.values).toEqual({ temp: 6 });
  });
});
