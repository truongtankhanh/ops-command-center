/** Postgres `NOTIFY` channel on which the relay announces the ids it published (ADR-0008). */
export const OUTBOX_CHANNEL = 'outbox_published';

/** In-process bus events about outbox delivery itself, not domain events. */
export const OutboxEvents = {
  /** This process's listener reconnected, and may have missed notifications while it was down. */
  Resynced: 'outbox.resynced',
} as const;
