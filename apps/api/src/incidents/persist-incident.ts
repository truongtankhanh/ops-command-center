import type { EntityManager } from 'typeorm';
import { IncidentEventEntity } from './incident-event.entity';
import { IncidentEntity } from './incident.entity';

/**
 * Saves an incident together with the timeline entries its transitions produced.
 * Must be called inside a transaction so both writes commit or roll back together.
 */
export async function persistIncident(
  manager: EntityManager,
  incident: IncidentEntity,
): Promise<IncidentEntity> {
  const events = incident.pendingEvents ?? [];
  const saved = await manager.save(IncidentEntity, incident);
  if (events.length > 0) {
    await manager.save(
      IncidentEventEntity,
      events.map((event) => Object.assign(event, { incidentId: saved.id })),
    );
  }
  saved.pendingEvents = [];
  return saved;
}
