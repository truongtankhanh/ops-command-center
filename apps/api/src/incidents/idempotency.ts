import { createHash } from 'node:crypto';
import type { IncidentDetail } from '@occ/contracts';
import type { EntityManager } from 'typeorm';
import { IdempotencyKeyReusedError } from '../common/domain-errors';
import { IdempotencyKeyEntity } from './idempotency-key.entity';

/**
 * Idempotent incident creation (ADR-0009). The key row is written in the same transaction as the
 * incident, so a key is stored exactly when its incident committed, and a failed request leaves
 * the key free for the retry.
 */

/** How long a key protects against a duplicate. Expired rows count as absent. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

/** Only successful creations are stored; anything else rolls the key back with the incident. */
const STORED_STATUS = 201;

export type IdempotencyClaim = { claimed: true } | { claimed: false; body: IncidentDetail };

/** SHA-256 of the body with object keys sorted, so key order and formatting do not count. */
export function fingerprint(body: object): string {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(body)))
    .digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
  );
}

/**
 * A key as stored: the client's value, scoped to the user who sent it (ADR-0010). An object, not
 * two string parameters, so subject and key cannot be swapped by accident.
 */
export interface IdempotencyKeyId {
  subject: string;
  key: string;
}

/**
 * Takes the key for this transaction, or returns the response it already produced. Must run
 * inside the transaction that creates the incident, before any other write.
 *
 * The insert comes first on purpose: a concurrent request with the same key blocks on the primary
 * key until this transaction ends (bounded by the session `lock_timeout`), then sees the committed
 * row and replays it. An expired row is taken over as if it were new.
 */
export async function claimIdempotencyKey(
  manager: EntityManager,
  id: IdempotencyKeyId,
  requestHash: string,
): Promise<IdempotencyClaim> {
  const claimed: unknown[] = await manager.query(
    `INSERT INTO "idempotency_key" ("subject", "key", "request_hash", "expires_at")
     VALUES ($1, $2, $3, now() + $4::integer * interval '1 millisecond')
     ON CONFLICT ("subject", "key") DO UPDATE
       SET "request_hash" = EXCLUDED."request_hash", "response_status" = NULL,
           "response_body" = NULL, "incident_id" = NULL, "created_at" = now(),
           "expires_at" = EXCLUDED."expires_at"
       WHERE "idempotency_key"."expires_at" <= now()
     RETURNING "key"`,
    [id.subject, id.key, requestHash, IDEMPOTENCY_TTL_MS],
  );
  if (claimed.length > 0) return { claimed: true };

  // READ COMMITTED: this statement sees the row the other transaction just committed. The
  // `ON CONFLICT` above locked it, so the expiry cleanup cannot delete it in between.
  const existing = await manager.findOneByOrFail(IdempotencyKeyEntity, {
    subject: id.subject,
    key: id.key,
  });
  if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
  if (!existing.responseBody) {
    throw new Error('Idempotency key row committed without a response');
  }
  return { claimed: false, body: existing.responseBody };
}

/** Records the response for a key this transaction claimed. */
export async function storeIdempotentResponse(
  manager: EntityManager,
  id: IdempotencyKeyId,
  detail: IncidentDetail,
): Promise<void> {
  await manager.update(
    IdempotencyKeyEntity,
    { subject: id.subject, key: id.key },
    { responseStatus: STORED_STATUS, responseBody: detail, incidentId: detail.id },
  );
}
