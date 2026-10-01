import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Incident, IncidentDetail } from '@occ/contracts';
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
  list(@Query() query: ListIncidentsQueryDto): Promise<Incident[]> {
    return this.incidents.list(query);
  }

  /** One incident with its full timeline. */
  @Get(':id')
  @ApiOkResponse({ type: IncidentDetailDto })
  @ApiNotFoundResponse()
  get(@Param('id', ParseUUIDPipe) id: string): Promise<IncidentDetail> {
    return this.incidents.get(id);
  }

  /** Report a new incident on behalf of an operator. */
  @Post()
  @ApiCreatedResponse({ type: IncidentDetailDto })
  @ApiNotFoundResponse({ description: 'Zone does not exist' })
  report(@Body() body: ReportIncidentDto): Promise<IncidentDetail> {
    return this.incidents.report(body, 'operator');
  }

  /** Mark an open incident as being handled. */
  @Post(':id/acknowledge')
  @HttpCode(200)
  @ApiOkResponse({ type: IncidentDetailDto })
  @ApiConflictResponse({ description: 'Incident is not open' })
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionIncidentDto,
  ): Promise<IncidentDetail> {
    return this.incidents.acknowledge(id, body.note);
  }

  /** Close an incident, optionally with a resolution note. */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOkResponse({ type: IncidentDetailDto })
  @ApiConflictResponse({ description: 'Incident is already resolved' })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionIncidentDto,
  ): Promise<IncidentDetail> {
    return this.incidents.resolve(id, body.note);
  }
}
