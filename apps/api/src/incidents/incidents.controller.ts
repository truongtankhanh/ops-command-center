import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Incident, IncidentDetail } from '@occ/contracts';
import { ApiErrorDto } from '../common/api-error.dto';
import { IncidentDetailDto, IncidentDto } from './dto/incident.dto';
import {
  ListIncidentsQueryDto,
  ReportIncidentDto,
  TransitionIncidentDto,
} from './dto/incident-requests.dto';
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

  /** Report a new incident on behalf of an operator. */
  @Post()
  @ApiCreatedResponse({ type: IncidentDetailDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid body' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Zone does not exist' })
  report(@Body() body: ReportIncidentDto): Promise<IncidentDetail> {
    return this.incidents.report(body, 'operator');
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
