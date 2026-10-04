import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER } from '@occ/contracts';
import type { Request } from 'express';

/** Printable ASCII without spaces, 1–255 characters: an opaque token, as in the IETF draft. */
const KEY_PATTERN = /^[\x21-\x7E]{1,255}$/;

/**
 * The raw `Idempotency-Key` header. Nest's `@Headers()` accepts no pipes, so validation goes
 * through this decorator instead: `@IdempotencyKeyHeader(IdempotencyKeyPipe)`.
 */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const value = ctx.switchToHttp().getRequest<Request>().headers[
      IDEMPOTENCY_KEY_HEADER.toLowerCase()
    ];
    return Array.isArray(value) ? value.join(', ') : value;
  },
);

/**
 * Validates the optional `Idempotency-Key` header. The global `ValidationPipe` only checks DTOs,
 * so a single header needs its own pipe. An empty or repeated header (Express joins repeats with
 * `", "`) fails too. The error has the same shape as body validation errors.
 */
@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<string | undefined, string | undefined> {
  transform(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    if (!KEY_PATTERN.test(value)) {
      throw new BadRequestException([
        `${IDEMPOTENCY_KEY_HEADER} must be 1 to 255 printable ASCII characters without spaces`,
      ]);
    }
    return value;
  }
}
