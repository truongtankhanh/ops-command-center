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

export class EntityNotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found`);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(subject: string, from: string, action: string) {
    super(`Cannot ${action} ${subject}: it is already ${from}`);
  }
}
