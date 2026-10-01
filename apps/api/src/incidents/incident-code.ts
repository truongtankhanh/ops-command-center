import type { EntityManager } from 'typeorm';

/** Next human-friendly code from the database sequence: `INC-000042`. Safe under concurrency. */
export async function nextIncidentCode(manager: EntityManager): Promise<string> {
  const [row] = (await manager.query(`SELECT nextval('incident_code_seq') AS value`)) as {
    value: string;
  }[];
  return `INC-${String(row!.value).padStart(6, '0')}`;
}
