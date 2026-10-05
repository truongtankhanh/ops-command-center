import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  type HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.decorators';
import { OutboxListenerHealthIndicator } from './outbox-listener.health';

/**
 * Half the Docker probe's 3 s timeout (ADR-0013). Also cuts short a wait for a pool slot, which
 * could otherwise last `POOL_WAIT_MS` (5 s).
 */
const DB_PING_TIMEOUT_MS = 1_500;

/**
 * Operational probes for Docker and orchestrators — kept out of the public OpenAPI contract.
 * Public: the Docker healthcheck and CI call them without a token, and they reveal nothing.
 * Not rate-limited (ADR-0012): a throttled probe would mark a healthy replica down.
 */
@Public()
@SkipThrottle()
@ApiExcludeController()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  /** Last readiness verdict, so only changes are logged. The process listens only once ready. */
  private wasReady = true;

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly outboxListener: OutboxListenerHealthIndicator,
  ) {}

  /**
   * Liveness: is this process serving HTTP? Never checks a dependency: a failed liveness probe
   * restarts the container, and restarting every replica at once fixes no database outage.
   * Used by the Docker `HEALTHCHECK`.
   */
  @Get('live')
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * Readiness: can this replica serve traffic now? Needs the database and its own `LISTEN`
   * connection, without which consoles here miss live events. Migrations need no check, because
   * they are applied before the process listens. Keycloak is left out on purpose (ADR-0010).
   */
  @Get('ready')
  async ready(): Promise<HealthCheckResult> {
    try {
      const result = await this.health.check([
        () => this.db.pingCheck('database', { timeout: DB_PING_TIMEOUT_MS }),
        () => this.outboxListener.isHealthy('outbox_listener'),
      ]);
      this.recordReady();
      return result;
    } catch (error) {
      throw this.notReady(error);
    }
  }

  private recordReady(): void {
    if (this.wasReady) return;
    this.wasReady = true;
    this.logger.log('Ready again');
  }

  /**
   * Names the failed checks without their messages: a driver error can carry an internal address,
   * which stays in the log.
   */
  private notReady(error: unknown): unknown {
    if (!(error instanceof ServiceUnavailableException)) return error;
    const result = error.getResponse() as HealthCheckResult;
    const failed = failedChecks(result);
    if (this.wasReady) {
      this.wasReady = false;
      this.logger.warn(
        `Not ready: ${failed.map(({ key, reason }) => `${key} (${reason})`).join(', ')}`,
      );
    }
    return new ServiceUnavailableException(`Not ready: ${failed.map(({ key }) => key).join(', ')}`);
  }
}

function failedChecks(result: HealthCheckResult): { key: string; reason: string }[] {
  if (result.status === 'shutting_down') return [{ key: 'shutting down', reason: 'stopping' }];
  return Object.entries(result.error ?? {}).map(([key, value]) => ({
    key,
    reason: String(value?.message ?? value?.status ?? 'down'),
  }));
}
