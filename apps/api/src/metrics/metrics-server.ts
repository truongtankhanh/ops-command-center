import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Registry } from '@prometheus-io/client';

/**
 * Serves `GET /metrics` on a port of its own, outside the Express app (ADR-0015). No `/api` route
 * exists for nginx to proxy, and none of the global guards, the request log or the HTTP metrics
 * apply to the scrape. Access is the network's job: Compose publishes no host port for it.
 */
@Injectable()
export class MetricsServer implements OnApplicationShutdown {
  private readonly logger = new Logger(MetricsServer.name);
  private server?: Server;

  constructor(private readonly registry: Registry) {}

  /** Called by `main.ts` only, after the API listens, so e2e apps never bind the port. */
  async listen(port: number): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
  }

  /** The scrape port goes away with the process (ADR-0013). Idle keep-alive sockets are closed. */
  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await this.registry.metrics();
      res.writeHead(200, { 'Content-Type': this.registry.contentType }).end(body);
    } catch (error) {
      this.logger.error(
        `Metrics scrape failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      res.writeHead(500).end();
    }
  }
}
