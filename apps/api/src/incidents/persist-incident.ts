import type { EntityManager } from 'typeorm';
import { currentRequestId } from '../logging/request-context';
import { OutboxEntity, type OutboxEventName } from '../outbox/outbox.entity';
import { IncidentEventEntity } from './incident-event.entity';
import { IncidentEntity } from './incident.entity';

/**
 * Saves an incident together with the timeline entries its transitions produced and, when
 * `outboxEvent` is given, the outbox row that announces the change (ADR-0007).
 * Must be called inside a transaction so all writes commit or roll back together.
 * The seed omits `outboxEvent`: nobody is listening while it runs.
 */
export async function persistIncident(
  manager: EntityManager,
  incident: IncidentEntity,
  outboxEvent?: OutboxEventName,
): Promise<IncidentEntity> {
  const events = incident.pendingEvents ?? [];
  const saved = await manager.save(IncidentEntity, incident);
  if (events.length > 0) {
    await manager.save(
      IncidentEventEntity,
      events.map((event) => Object.assign(event, { incidentId: saved.id })),
    );
  }
  if (outboxEvent) {
    // The request or job run behind the change, so its delivery logs share one id (ADR-0014).
    await manager.insert(
      OutboxEntity,
      OutboxEntity.create(outboxEvent, saved.toContract(), currentRequestId()),
    );
  }
  saved.pendingEvents = [];
  return saved;
}
