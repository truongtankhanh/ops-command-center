import { ServiceUnavailableException } from '@nestjs/common';
import { HealthIndicatorService, TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { OutboxListener } from '../outbox/outbox-listener.service';
import { HealthController } from './health.controller';
import { OutboxListenerHealthIndicator } from './outbox-listener.health';

/** Stands in for `TypeOrmHealthIndicator`, built on the same Terminus attempt and timeout. */
class FakeDatabase {
  state: 'up' | 'down' | 'hanging' = 'up';
  private readonly indicator = new HealthIndicatorService();

  pingCheck(key: string, options: { timeout: number }) {
    return this.indicator
      .check(key)
      .attempt(() => {
        if (this.state === 'down') throw new Error('connect ECONNREFUSED 172.18.0.2:5432');
        if (this.state === 'hanging') return new Promise<void>(() => undefined);
      })
      .withTimeout(options.timeout);
  }
}

/** The 503 a call failed with; fails the test if the call succeeded or failed otherwise. */
async function unavailable(call: Promise<unknown>): Promise<ServiceUnavailableException> {
  const error = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ServiceUnavailableException);
  return error as ServiceUnavailableException;
}

describe('HealthController', () => {
  let moduleRef: TestingModule;
  let controller: HealthController;
  let database: FakeDatabase;
  let listening: boolean;

  beforeEach(async () => {
    database = new FakeDatabase();
    listening = true;
    moduleRef = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
      controllers: [HealthController],
      providers: [
        OutboxListenerHealthIndicator,
        { provide: OutboxListener, useValue: { isListening: () => listening } },
      ],
    })
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue(database)
      .compile();
    controller = moduleRef.get(HealthController);
  });

  afterEach(() => moduleRef.close());

  describe('liveness', () => {
    it('stays up with the database and the listener down, without touching either', async () => {
      database.state = 'down';
      listening = false;
      const ping = jest.spyOn(database, 'pingCheck');

      await expect(controller.live()).resolves.toEqual({
        status: 'ok',
        info: {},
        error: {},
        details: {},
      });
      expect(ping).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('is ready with the database up and the listener listening', async () => {
      await expect(controller.ready()).resolves.toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' }, outbox_listener: { status: 'up' } },
      });
    });

    it('answers 503 naming the database when it is down, without the driver message', async () => {
      database.state = 'down';
      jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);

      const error = await unavailable(controller.ready());

      expect(error.getStatus()).toBe(503);
      expect(error.message).toBe('Not ready: database');
    });

    it('gives up on a hanging ping after 1.5 s, inside the 3 s probe timeout', async () => {
      database.state = 'hanging';
      const warn = jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);
      const started = Date.now();

      const error = await unavailable(controller.ready());

      expect(Date.now() - started).toBeLessThan(3_000);
      expect(error.message).toBe('Not ready: database');
      expect(warn).toHaveBeenCalledWith('Not ready: database (timeout of 1500ms exceeded)');
    });

    it('answers 503 when the outbox listener is not listening', async () => {
      listening = false;
      jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);

      const error = await unavailable(controller.ready());

      expect(error.message).toBe('Not ready: outbox_listener');
    });

    it('names every failed check, not only the first', async () => {
      database.state = 'down';
      listening = false;
      jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);

      const error = await unavailable(controller.ready());

      expect(error.message).toBe('Not ready: database, outbox_listener');
    });

    it('answers 503 once the application is shutting down', async () => {
      jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);
      await moduleRef.close();

      const error = await unavailable(controller.ready());

      expect(error.message).toBe('Not ready: shutting down');
    });

    it('logs when readiness changes, not on every probe', async () => {
      const warn = jest.spyOn(controller['logger'], 'warn').mockImplementation(() => undefined);
      const log = jest.spyOn(controller['logger'], 'log').mockImplementation(() => undefined);

      database.state = 'down';
      await unavailable(controller.ready());
      await unavailable(controller.ready());
      database.state = 'up';
      await controller.ready();
      await controller.ready();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'Not ready: database (connect ECONNREFUSED 172.18.0.2:5432)',
      );
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith('Ready again');
    });
  });
});
