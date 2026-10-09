/**
 * Errors raised by domain logic. They carry meaning, not HTTP status codes;
 * the exception filter decides how each one is presented to API clients.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** `id` is left out for a singleton such as the site plan, which is not looked up by id. */
export class EntityNotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(id === undefined ? `${entity} was not found` : `${entity} ${id} was not found`);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(subject: string, from: string, action: string) {
    super(`Cannot ${action} ${subject}: it is already ${from}`);
  }
}

/**
 * The caller's role holds the permission, but not for this incident's category (ADR-0021): a
 * technician acknowledging a security incident, for example.
 */
export class CategoryOutOfScopeError extends DomainError {
  constructor() {
    super('Not allowed for this category');
  }
}

/** A reported position must agree with the zone it names, or the map and the zone disagree. */
export class PositionOutsideZoneError extends DomainError {
  constructor(zoneCode: string) {
    super(`position is outside zone ${zoneCode}`);
  }
}

/** A retry must repeat the original request; a different body under the same key is a client bug. */
export class IdempotencyKeyReusedError extends DomainError {
  constructor() {
    super('This Idempotency-Key was already used with a different request body');
  }
}
