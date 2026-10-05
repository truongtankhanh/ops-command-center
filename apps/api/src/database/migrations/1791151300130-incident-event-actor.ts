import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recorded as the author of every entry written before actors existed (ADR-0011). Inline rather
 * than imported from the app: a migration must keep doing what it did when it first ran.
 */
const BACKFILL_ACTOR = { kind: 'system', subject: 'system', displayName: 'System' };

export class IncidentEventActor1791151300130 implements MigrationInterface {
  name = 'IncidentEventActor1791151300130';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Constant defaults are metadata-only (no table rewrite) and give every existing row the
    // backfill actor. The CHECK is the one step that scans "incident_event", under the lock taken by
    // ADD COLUMN; `NOT VALID` + `VALIDATE` would not help while every migration shares one
    // transaction (`migrate-on-boot.ts`). If this table is ever large, put the CHECK in a migration
    // of its own as `NOT VALID`, then validate it in another.
    await queryRunner.query(`
      ALTER TABLE "incident_event"
        ADD COLUMN "actor_kind" varchar(16) NOT NULL DEFAULT 'system'
          CONSTRAINT "incident_event_actor_kind_check" CHECK ("actor_kind" IN ('user', 'system')),
        ADD COLUMN "actor_subject" varchar(255) NOT NULL DEFAULT 'system',
        ADD COLUMN "actor_name" varchar(255) NOT NULL DEFAULT 'System'`);
    // From here on, every entry must name its actor: an insert that forgets one fails.
    await queryRunner.query(`
      ALTER TABLE "incident_event"
        ALTER COLUMN "actor_kind" DROP DEFAULT,
        ALTER COLUMN "actor_subject" DROP DEFAULT,
        ALTER COLUMN "actor_name" DROP DEFAULT`);

    // A replay must match what `GET /incidents/:id` now returns, so stored responses get the same
    // backfill actor on each timeline entry. Deleting the keys instead would let a retry that
    // straddles the deploy create a duplicate incident. Going through `jsonb` reorders the keys of
    // these bodies, so their replays are no longer byte-identical to the first response.
    // `jsonb_typeof` is NULL for a NULL body (a claim still in flight), which skips it.
    await queryRunner.query(
      `
      UPDATE "idempotency_key" AS k
      SET "response_body" = jsonb_set(
        k."response_body"::jsonb,
        '{timeline}',
        (
          SELECT coalesce(jsonb_agg(t.entry || $1::jsonb ORDER BY t.position), '[]'::jsonb)
          FROM jsonb_array_elements(k."response_body"::jsonb -> 'timeline')
            WITH ORDINALITY AS t(entry, position)
        )
      )::json
      WHERE jsonb_typeof(k."response_body"::jsonb -> 'timeline') = 'array'`,
      [JSON.stringify({ actor: BACKFILL_ACTOR })],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Actors recorded since the upgrade are lost. Stored idempotent responses keep their `actor`
    // fields: an extra field is harmless to the previous code, and the keys expire within 24 h.
    await queryRunner.query(`
      ALTER TABLE "incident_event"
        DROP COLUMN "actor_kind",
        DROP COLUMN "actor_subject",
        DROP COLUMN "actor_name"`);
  }
}
