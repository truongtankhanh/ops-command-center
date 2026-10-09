import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@occ/contracts';
import type { Request, Response } from 'express';
import {
  CategoryOutOfScopeError,
  DomainError,
  EntityNotFoundError,
  InvalidTransitionError,
  PositionOutsideZoneError,
} from './domain-errors';

/** One place that turns any thrown error into the `ApiError` body clients rely on. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { statusCode, message } = this.resolve(exception);
    if (statusCode >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl}`, (exception as Error)?.stack);
    }

    const body: ApiError = {
      statusCode,
      error: HttpStatus[statusCode] ?? 'Error',
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };
    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): { statusCode: number; message: string | string[] } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'object' && res !== null && 'message' in res
          ? (res as { message: string | string[] }).message
          : exception.message;
      return { statusCode: exception.getStatus(), message };
    }
    if (exception instanceof EntityNotFoundError) {
      return { statusCode: HttpStatus.NOT_FOUND, message: exception.message };
    }
    if (exception instanceof InvalidTransitionError) {
      return { statusCode: HttpStatus.CONFLICT, message: exception.message };
    }
    // An invalid body like any other, so not the fallback 422: clients read a 422 on
    // POST /incidents as a reused Idempotency-Key (ADR-0009).
    if (exception instanceof PositionOutsideZoneError) {
      return { statusCode: HttpStatus.BAD_REQUEST, message: exception.message };
    }
    // The category half of authorization: `RolesGuard` checked the permission, the service checks
    // the incident's category once it is loaded (ADR-0021).
    if (exception instanceof CategoryOutOfScopeError) {
      return { statusCode: HttpStatus.FORBIDDEN, message: exception.message };
    }
    if (exception instanceof DomainError) {
      return { statusCode: HttpStatus.UNPROCESSABLE_ENTITY, message: exception.message };
    }
    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}
