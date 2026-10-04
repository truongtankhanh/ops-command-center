import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../auth/auth.decorators';

/**
 * Operational probe for Docker and orchestrators — kept out of the public OpenAPI contract.
 * Public: the Docker healthcheck and CI call it without a token, and it reveals nothing.
 */
@Public()
@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /** Liveness + database reachability. Used by Docker health checks. */
  @Get()
  async check(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', database: 'up' };
  }
}
