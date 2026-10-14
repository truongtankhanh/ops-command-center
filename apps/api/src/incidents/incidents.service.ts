import { Injectable } from '@nestjs/common';
import {
  type Actor,
  categoryOf,
  hasPermissionFor,
  INCIDENT_SEVERITIES,
  type Incident,
  type IncidentDetail,
  IncidentEvents,
  type IncidentSource,
  type ListIncidentsQuery,
  type Permission,
  type ReportIncidentRequest,
  type Role,
} from '@occ/contracts';
import { DataSource, type EntityManager, Not, QueryFailedError } from 'typeorm';
import { AssetEntity } from '../assets/asset.entity';
import { TelemetryRuleEntity } from '../assets/telemetry-rule.entity';
import {
  CategoryOutOfScopeError,
  EntityNotFoundError,
  PositionOutsideZoneError,
} from '../common/domain-errors';
import { isInPolygon } from '../common/geo';
import { OutboxRelay } from '../outbox/outbox-relay.service';
import { ZoneEntity } from '../zones/zone.entity';
import { SystemActors } from './actors';
import { DEFAULT_INCIDENT_LIMIT } from './dto/incident-requests.dto';
import {
  claimIdempotencyKey,
  fingerprint,
  type IdempotencyKeyId,
  storeIdempotentResponse,
} from './idempotency';
import { nextIncidentCode } from './incident-code';
import { IncidentEntity } from './incident.entity';
import { persistIncident } from './persist-incident';

const SEVERITY_ORDER = `ARRAY[${INCIDENT_SEVERITIES.map((s) => `'${s}'`).join(',')}]::varchar[]`;

/**
 * Whose category scope an acknowledge or resolve is checked against (ADR-0021): the signed-in
 * user's roles, or `'system'` for changes the API makes on its own (`SystemActors`), which are not
 * scoped. Required, so a new caller cannot skip the check by leaving it out; never `'system'` for a
 * request.
 */
export type TransitionScope = readonly Role[] | 'system';

/** The partial unique index that allows one unresolved incident per asset and rule (ADR-0018). */
const OPEN_INCIDENT_INDEX = 'uq_incident_open_asset_rule';
/** `incident.title` holds 160 characters; a rule's and an asset's names can be 120 each. */
const MAX_TITLE_LENGTH = 160;

/** What the telemetry leader knows when a rule's breach has lasted long enough (ADR-0018). */
export interface TelemetryIncidentInput {
  assetId: string;
  telemetryRuleId: string;
  /** The evidence, e.g. `motorTempC 92 > 85 for 60 s`: the note of the `reported` entry. */
  note: string;
}

/**
 * `already_open` is an expected answer, not a failure: the pair already has an unresolved
 * incident, so the breach is skipped and the caller counts it.
 */
export type TelemetryIncidentResult =
  { outcome: 'raised'; incident: IncidentDetail } | { outcome: 'already_open' };

/** A lost race on `uq_incident_open_asset_rule`, and no other unique violation (the `code`). */
function violatesOpenIncidentIndex(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const { code, constraint } = error.driverError as { code?: string; constraint?: string };
  return code === '23505' && constraint === OPEN_INCIDENT_INDEX;
}

/** `<rule name> — <asset name>` (ADR-0018), cut to the column's length by characters. */
function telemetryTitle(ruleName: string, assetName: string): string {
  const characters = [...`${ruleName} — ${assetName}`];
  return characters.length > MAX_TITLE_LENGTH
    ? `${characters.slice(0, MAX_TITLE_LENGTH - 1).join('')}…`
    : characters.join('');
}

/**
 * Application service for incidents. Every write runs in one transaction that also records its
 * domain event in the outbox, so an event exists exactly when its change committed. `OutboxRelay`
 * publishes it to listeners (e.g. the WebSocket gateway); this service only nudges it (ADR-0007).
 * Reporting with an idempotency key is safe to retry: the same key returns the first response
 * instead of creating a second incident (ADR-0009). Every write takes the actor to record on the
 * timeline; callers pass the signed-in user or a system actor, never request input (ADR-0011).
 * Acknowledge and resolve are also scoped by the incident's category (ADR-0021).
 */
@Injectable()
export class IncidentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxRelay,
  ) {}

  /** Unresolved first, then most severe, then newest. */
  async list(query: ListIncidentsQuery = {}): Promise<Incident[]> {
    const qb = this.dataSource.getRepository(IncidentEntity).createQueryBuilder('incident');
    if (query.status?.length)
      qb.andWhere('incident.status IN (:...status)', { status: query.status });
    if (query.severity?.length) {
      qb.andWhere('incident.severity IN (:...severity)', { severity: query.severity });
    }
    const incidents = await qb
      .orderBy(`CASE WHEN incident.status = 'resolved' THEN 1 ELSE 0 END`, 'ASC')
      .addOrderBy(`array_position(${SEVERITY_ORDER}, incident.severity)`, 'DESC')
      .addOrderBy('incident.reportedAt', 'DESC')
      .limit(query.limit ?? DEFAULT_INCIDENT_LIMIT)
      .getMany();
    return incidents.map((incident) => incident.toContract());
  }

  get(id: string): Promise<IncidentDetail> {
    return this.loadDetail(this.dataSource.manager, id);
  }

  /**
   * With `idempotencyKey`, a repeat of the same request by the same user returns the stored first
   * response and creates nothing; the same key with a different body throws
   * `IdempotencyKeyReusedError`. Another user's identical key is a different key.
   */
  async report(
    request: ReportIncidentRequest,
    source: IncidentSource,
    actor: Actor,
    idempotencyKey?: IdempotencyKeyId,
  ): Promise<IncidentDetail> {
    const idempotency = idempotencyKey
      ? { id: idempotencyKey, requestHash: fingerprint(request) }
      : undefined;

    const { detail, created } = await this.dataSource.transaction(async (manager) => {
      // Before the zone lookup and `nextval`, so a replay burns no incident code.
      if (idempotency) {
        const claim = await claimIdempotencyKey(manager, idempotency.id, idempotency.requestHash);
        if (!claim.claimed) return { detail: claim.body, created: false };
      }

      const zone = await manager.findOneBy(ZoneEntity, { id: request.zoneId });
      if (!zone) throw new EntityNotFoundError('Zone', request.zoneId);
      if (request.position && !isInPolygon(request.position, zone.polygon)) {
        throw new PositionOutsideZoneError(zone.code);
      }
      const [lng, lat] = request.position ?? zone.center;

      // Read inside the transaction: the stored response must commit together with the incident.
      const detail = await this.createIncident(
        manager,
        {
          type: request.type,
          severity: request.severity,
          title: request.title,
          description: request.description,
          zoneId: zone.id,
          lng,
          lat,
          source,
        },
        actor,
      );
      if (idempotency) await storeIdempotentResponse(manager, idempotency.id, detail);
      return { detail, created: true };
    });

    if (created) void this.outbox.drain();
    return detail;
  }

  /**
   * Raises the incident of a rule's sustained breach as the `telemetry` system actor (ADR-0018).
   * The asset and the rule are read here, in the transaction, so the zone, the position, the type
   * and the severity are always the catalogue's and never a caller's copy; a missing one throws
   * `EntityNotFoundError`. It goes through the same write and outbox row as `report()`.
   *
   * An unresolved incident for the pair answers `already_open` without a change. The check runs
   * before the incident code is drawn, so a repeat burns no `INC-…` number; the unique index is
   * the backstop for two writers racing, and that loser answers `already_open` too.
   */
  async reportFromTelemetry(input: TelemetryIncidentInput): Promise<TelemetryIncidentResult> {
    let result: TelemetryIncidentResult;
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const asset = await manager.findOneBy(AssetEntity, { id: input.assetId });
        if (!asset) throw new EntityNotFoundError('Asset', input.assetId);
        const rule = await manager.findOneBy(TelemetryRuleEntity, { id: input.telemetryRuleId });
        if (!rule) throw new EntityNotFoundError('Telemetry rule', input.telemetryRuleId);

        const open = await manager.existsBy(IncidentEntity, {
          assetId: asset.id,
          telemetryRuleId: rule.id,
          status: Not('resolved'),
        });
        if (open) return { outcome: 'already_open' } as const;

        const incident = await this.createIncident(
          manager,
          {
            type: rule.incidentType,
            severity: rule.severity,
            title: telemetryTitle(rule.name, asset.name),
            zoneId: asset.zoneId,
            lng: asset.lng,
            lat: asset.lat,
            source: 'telemetry',
            assetId: asset.id,
            telemetryRuleId: rule.id,
            note: input.note,
          },
          SystemActors.telemetry,
        );
        return { outcome: 'raised', incident } as const;
      });
    } catch (error) {
      if (violatesOpenIncidentIndex(error)) return { outcome: 'already_open' };
      throw error;
    }

    if (result.outcome === 'raised') void this.outbox.drain();
    return result;
  }

  acknowledge(
    id: string,
    actor: Actor,
    scope: TransitionScope,
    note?: string,
  ): Promise<IncidentDetail> {
    return this.transition(id, 'incident:acknowledge', scope, (incident, at) =>
      incident.acknowledge(at, actor, note ?? null),
    );
  }

  resolve(
    id: string,
    actor: Actor,
    scope: TransitionScope,
    note?: string,
  ): Promise<IncidentDetail> {
    return this.transition(id, 'incident:resolve', scope, (incident, at) =>
      incident.resolve(at, actor, note ?? null),
    );
  }

  /** Loads the incident under a row lock so concurrent operators cannot both transition it. */
  private async transition(
    id: string,
    permission: Permission,
    scope: TransitionScope,
    apply: (incident: IncidentEntity, at: Date) => void,
  ): Promise<IncidentDetail> {
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(IncidentEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new EntityNotFoundError('Incident', id);
      // Before `apply`, so an out-of-scope incident answers 403 even when the transition itself
      // would be a 409. Throwing rolls back: the lock is released and no outbox row is written.
      if (scope !== 'system' && !hasPermissionFor(scope, permission, categoryOf(locked.type))) {
        throw new CategoryOutOfScopeError();
      }
      apply(locked, this.now());
      await persistIncident(manager, locked, IncidentEvents.Updated);
    });

    void this.outbox.drain();
    return this.get(id);
  }

  /**
   * Draws the code, saves the incident with its `reported` entry and the outbox row, and reads it
   * back, all on the caller's transaction. Shared by `report()` and `reportFromTelemetry()` so a
   * system-raised incident is written exactly like an operator's.
   */
  private async createIncident(
    manager: EntityManager,
    props: Omit<Parameters<typeof IncidentEntity.report>[0], 'code' | 'at'>,
    actor: Actor,
  ): Promise<IncidentDetail> {
    const incident = await persistIncident(
      manager,
      IncidentEntity.report(
        { ...props, code: await nextIncidentCode(manager), at: this.now() },
        actor,
      ),
      IncidentEvents.Created,
    );
    return this.loadDetail(manager, incident.id);
  }

  private async loadDetail(manager: EntityManager, id: string): Promise<IncidentDetail> {
    const incident = await manager.findOne(IncidentEntity, {
      where: { id },
      relations: { timeline: true },
    });
    if (!incident) throw new EntityNotFoundError('Incident', id);
    return incident.toDetailContract();
  }

  /** Overridable clock — keeps time-dependent behaviour testable. */
  protected now(): Date {
    return new Date();
  }
}
