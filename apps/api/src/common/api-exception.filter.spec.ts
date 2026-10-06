import { type ArgumentsHost, BadRequestException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';
import {
  EntityNotFoundError,
  InvalidTransitionError,
  PositionOutsideZoneError,
} from './domain-errors';

function hostFor(path = '/api/incidents/1') {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', originalUrl: path }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  it.each([
    [new EntityNotFoundError('Incident', '1'), 404, 'NOT_FOUND'],
    [new InvalidTransitionError('INC-000001', 'resolved', 'resolve'), 409, 'CONFLICT'],
    [new BadRequestException(['title should not be empty']), 400, 'BAD_REQUEST'],
    [new PositionOutsideZoneError('BLD-LIB'), 400, 'BAD_REQUEST'],
  ])('maps %p to %i', (error, statusCode, name) => {
    const { host, status, json } = hostFor();

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(statusCode);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode, error: name, path: '/api/incidents/1' }),
    );
  });

  it('names a missing singleton without an id', () => {
    const { host, json } = hostFor('/api/site-plan');

    filter.catch(new EntityNotFoundError('Site plan'), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'Site plan was not found' }),
    );
  });

  it('hides internal error details behind a generic 500', () => {
    const { host, json } = hostFor();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);

    filter.catch(new Error('connection string leaked here'), host);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, message: 'Internal server error' }),
    );
  });
});
