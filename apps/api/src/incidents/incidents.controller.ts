import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { IDEMPOTENCY_KEY_HEADER, type Incident, type IncidentDetail } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { IncidentDetailDto, IncidentDto } from './dto/incident.dto';
import {
  ListIncidentsQueryDto,
  ReportIncidentDto,
  TransitionIncidentDto,
} from './dto/incident-requests.dto';
import { IdempotencyKeyHeader, IdempotencyKeyPipe } from './idempotency-key.pipe';
import { IncidentsService } from './incidents.service';

@ApiTags('incidents')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  /** Incidents ordered for an operator: unresolved first, then by severity, then newest. */
  @Get()
  @ApiOkResponse({ type: [IncidentDto] })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid query parameters' })
  list(@Query() query: ListIncidentsQueryDto): Promise<Incident[]> {
    return this.incidents.list(query);
  }

  /** One incident with its full timeline. */
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: IncidentDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Malformed id' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Incident does not exist' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<IncidentDetail> {
    return this.incidents.get(id);
  }

  /**
   * Report a new incident on behalf of an operator. A retry with the same `Idempotency-Key` and
   * body returns the first response and creates nothing (ADR-0009).
   */
  @Post()
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: false,
    description:
      'Makes the request safe to retry for 24 h: the same key and body return the first response ' +
      'instead of creating another incident. Use a new random value (e.g. a UUID) per submission.',
    schema: { type: 'string', minLength: 1, maxLength: 255 },
  })
  @ApiCreatedResponse({ type: IncidentDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid body or Idempotency-Key' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Zone does not exist' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorDto,
    description: 'Idempotency-Key reused with a different body',
  })
  report(
    @Body() body: ReportIncidentDto,
    @IdempotencyKeyHeader(IdempotencyKeyPipe) idempotencyKey?: string,
  ): Promise<IncidentDetail> {
    return this.incidents.report(body, 'operator', idempotencyKey);
  }

  /** Mark an open incident as being handled. */
  @Post(':id/acknowledge')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: IncidentDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Malformed id or invalid body' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Incident does not exist' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Incident is not open' })
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionIncidentDto,
  ): Promise<IncidentDetail> {
    return this.incidents.acknowledge(id, body.note);
  }

  /** Close an incident, optionally with a resolution note. */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: IncidentDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Malformed id or invalid body' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Incident does not exist' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Incident is already resolved' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionIncidentDto,
  ): Promise<IncidentDetail> {
    return this.incidents.resolve(id, body.note);
  }
}
