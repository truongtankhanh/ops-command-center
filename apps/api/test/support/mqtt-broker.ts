import { createServer, type Server, type Socket } from 'node:net';
import { createBroker } from 'aedes';

/**
 * An MQTT 3.1.1 broker inside the test process, on a loopback port (ADR-0019: no container). It
 * can be stopped and started again on the same port, which is what a broker outage looks like to
 * the API's source: the address stays, the connection drops, and comes back.
 *
 * A restart is a new broker, so retained messages do not survive it, unlike a real broker with
 * persistence. The cases that use it do not depend on them.
 */
export interface TestBroker {
  /** `mqtt://127.0.0.1:<port>`, stable across `stop()` and `start()`. */
  readonly url: string;
  /** Drops every client and closes the listener. Safe to call twice. */
  stop(): Promise<void>;
  /** Listens again on the same port, with a fresh broker behind it. */
  start(): Promise<void>;
}

export interface BrokerCredentials {
  username: string;
  password: string;
}

interface Running {
  server: Server;
  sockets: Set<Socket>;
  close(): Promise<void>;
}

/**
 * Starts a broker on a free port. With `credentials`, a client that does not present exactly
 * these is refused, so the API's username and password are exercised and not just carried.
 */
export async function startBroker(credentials?: BrokerCredentials): Promise<TestBroker> {
  const port = await freePort();
  let running: Running | undefined;

  const broker: TestBroker = {
    url: `mqtt://127.0.0.1:${port}`,
    async start() {
      if (!running) running = await listen(port, credentials);
    },
    async stop() {
      const current = running;
      running = undefined;
      await current?.close();
    },
  };
  await broker.start();
  return broker;
}

async function listen(port: number, credentials?: BrokerCredentials): Promise<Running> {
  const aedes = createBroker(
    credentials
      ? {
          authenticate: (_client, username, password, done) => {
            done(
              null,
              username === credentials.username && password?.toString() === credentials.password,
            );
          },
        }
      : {},
  );
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    aedes.handle(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    server,
    sockets,
    close: () =>
      new Promise<void>((resolve) => {
        // `server.close()` waits for every connection to end, so end them first.
        for (const socket of sockets) socket.destroy();
        server.close(() => aedes.close(() => resolve()));
      }),
  };
}

/** A port nothing listens on now. Racy in principle, and fine on a developer's machine and in CI. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('No free port'))));
    });
  });
}
