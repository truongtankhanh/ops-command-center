import {
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type Incident,
  IncidentEvents,
} from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { io } from 'socket.io-client';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useConsole } from '../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../test-utils';
import { useLiveIncidents } from './useLiveIncidents';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));

type Handler = (...args: unknown[]) => void;

/** Just enough of a Socket.IO client socket: handlers can be fired by hand. */
function createFakeSocket() {
  const handlers = new Map<string, Handler>();
  const managerHandlers = new Map<string, Handler>();
  const call = (registry: Map<string, Handler>, event: string, args: unknown[]) => {
    const handler = registry.get(event);
    if (!handler) throw new Error(`No handler for ${event}`);
    handler(...args);
  };
  return {
    active: true,
    on: vi.fn((event: string, handler: Handler) => void handlers.set(event, handler)),
    io: {
      on: vi.fn((event: string, handler: Handler) => void managerHandlers.set(event, handler)),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    fire: (event: string, ...args: unknown[]) => call(handlers, event, args),
    fireManager: (event: string) => call(managerHandlers, event, []),
  };
}

const incident: Incident = {
  id: 'incident-1',
  code: 'INC-000042',
  type: 'medical',
  severity: 'high',
  status: 'open',
  title: 'Person down at entrance',
  description: null,
  zoneId: '6f1c2b1e-0000-4000-8000-000000000001',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
};

/** `Promise.withResolvers` is ES2024; the console targets ES2023. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('useLiveIncidents', () => {
  let socket: ReturnType<typeof createFakeSocket>;
  let client: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  /** The server refused the handshake: Socket.IO destroys the socket before `connect_error`. */
  const refuse = (reason: string) => {
    socket.active = false;
    socket.fire('connect_error', new Error(reason));
  };

  const connection = () => useConsole.getState().connection;

  function renderLive() {
    return renderHook(() => useLiveIncidents(), { wrapper: queryWrapper(client) });
  }

  /** The `auth` option the hook passed to `io()`. */
  function authOption() {
    const options = vi.mocked(io).mock.calls[0]![1] as {
      auth: (send: (data: object) => void) => void;
    };
    return options.auth;
  }

  beforeEach(() => {
    resetStore(useConsole);
    vi.useFakeTimers();
    // A jitter factor of exactly 1: retries fire at 1000, 2000, 4000… ms.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    socket = createFakeSocket();
    vi.mocked(io)
      .mockReset()
      .mockReturnValue(socket as unknown as ReturnType<typeof io>);
    vi.mocked(getAccessToken).mockReset().mockResolvedValue(null);
    vi.mocked(renewSession).mockReset().mockResolvedValue(false);
    client = createTestQueryClient();
    client.setQueryData(queryKeys.incidents, []);
    invalidate = vi.spyOn(client, 'invalidateQueries');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('handshake', () => {
    it('opens one WebSocket to the events namespace with a token callback', () => {
      renderLive();

      expect(io).toHaveBeenCalledTimes(1);
      expect(io).toHaveBeenCalledWith(
        EVENTS_NAMESPACE,
        expect.objectContaining({ transports: ['websocket'], auth: expect.any(Function) }),
      );
    });

    it('sends the current access token', async () => {
      vi.mocked(getAccessToken).mockResolvedValue('token-1');
      renderLive();
      const send = vi.fn();

      authOption()(send);

      await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ token: 'token-1' }));
    });

    it('sends an empty token when there is none', async () => {
      renderLive();
      const send = vi.fn();

      authOption()(send);

      await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ token: '' }));
    });
  });

  describe('connection state', () => {
    it('goes live on the first connect without refetching', () => {
      renderLive();

      socket.fire('connect');

      expect(connection()).toBe('live');
      expect(invalidate).not.toHaveBeenCalled();
    });

    it('refetches the incident list once after a reconnect', () => {
      renderLive();
      socket.fire('connect');

      socket.fire('disconnect');
      expect(connection()).toBe('offline');
      socket.fire('connect');

      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.incidents });
    });

    it('shows a reconnect in progress', () => {
      renderLive();

      socket.fireManager('reconnect_attempt');

      expect(connection()).toBe('connecting');
    });
  });

  describe('incident events', () => {
    it('adds a new incident to the list, marks it fresh and refreshes its detail', () => {
      renderLive();

      socket.fire(IncidentEvents.Created, incident);

      expect(client.getQueryData(queryKeys.incidents)).toEqual([incident]);
      expect(useConsole.getState().fresh.has(incident.id)).toBe(true);
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.incident(incident.id),
        exact: true,
      });
    });

    it('updates an incident without marking it fresh', () => {
      renderLive();

      socket.fire(IncidentEvents.Updated, incident);

      expect(client.getQueryData(queryKeys.incidents)).toEqual([incident]);
      expect(useConsole.getState().fresh.has(incident.id)).toBe(false);
    });
  });

  describe('refused handshake', () => {
    it('leaves a transport failure to Socket.IO', async () => {
      renderLive();
      socket.fire('connect');

      socket.fire('connect_error', new Error('websocket error'));
      await vi.advanceTimersByTimeAsync(60_000);

      expect(connection()).toBe('live');
      expect(renewSession).not.toHaveBeenCalled();
      expect(socket.connect).not.toHaveBeenCalled();
    });

    it('retries after a second when the identity provider is down', async () => {
      renderLive();

      refuse(EventsConnectErrors.IdentityProviderUnavailable);
      expect(connection()).toBe('offline');
      await vi.advanceTimersByTimeAsync(999);
      expect(socket.connect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(renewSession).not.toHaveBeenCalled();
    });

    it('renews the token before retrying an unauthorized connection', async () => {
      vi.mocked(renewSession).mockResolvedValue(true);
      renderLive();

      refuse(EventsConnectErrors.Unauthorized);
      await vi.advanceTimersByTimeAsync(1000);

      expect(renewSession).toHaveBeenCalledTimes(1);
      expect(socket.connect).toHaveBeenCalledTimes(1);
    });

    it('stays offline when the token cannot be renewed', async () => {
      renderLive();

      refuse(EventsConnectErrors.Unauthorized);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(socket.connect).not.toHaveBeenCalled();
      expect(connection()).toBe('offline');
    });

    it('doubles the wait after each refusal, up to 30 seconds', async () => {
      renderLive();
      const waits = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];

      for (const [retries, wait] of waits.entries()) {
        refuse(EventsConnectErrors.IdentityProviderUnavailable);
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(socket.connect).toHaveBeenCalledTimes(retries);
        await vi.advanceTimersByTimeAsync(1);
        expect(socket.connect).toHaveBeenCalledTimes(retries + 1);
      }
    });

    it('spreads retries with jitter', async () => {
      vi.mocked(Math.random).mockReturnValue(0);
      renderLive();

      refuse(EventsConnectErrors.IdentityProviderUnavailable);
      await vi.advanceTimersByTimeAsync(499);
      expect(socket.connect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(socket.connect).toHaveBeenCalledTimes(1);
    });

    it('starts the wait over after a successful connect', async () => {
      renderLive();
      refuse(EventsConnectErrors.IdentityProviderUnavailable);
      await vi.advanceTimersByTimeAsync(1000);
      refuse(EventsConnectErrors.IdentityProviderUnavailable);
      await vi.advanceTimersByTimeAsync(2000);
      expect(socket.connect).toHaveBeenCalledTimes(2);

      socket.fire('connect');
      refuse(EventsConnectErrors.IdentityProviderUnavailable);
      await vi.advanceTimersByTimeAsync(999);
      expect(socket.connect).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);

      expect(socket.connect).toHaveBeenCalledTimes(3);
    });

    it('refetches the incident list on the first connect after a refusal', async () => {
      renderLive();
      refuse(EventsConnectErrors.IdentityProviderUnavailable);
      await vi.advanceTimersByTimeAsync(1000);

      socket.fire('connect');

      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.incidents });
    });
  });

  describe('cleanup', () => {
    it('disconnects on unmount', () => {
      const { unmount } = renderLive();

      unmount();

      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('cancels a pending retry on unmount', async () => {
      const { unmount } = renderLive();
      refuse(EventsConnectErrors.IdentityProviderUnavailable);

      unmount();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(socket.connect).not.toHaveBeenCalled();
    });

    it('does not retry when a renewal finishes after unmount', async () => {
      const renewal = deferred<boolean>();
      vi.mocked(renewSession).mockReturnValue(renewal.promise);
      const { unmount } = renderLive();
      refuse(EventsConnectErrors.Unauthorized);

      unmount();
      renewal.resolve(true);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(socket.connect).not.toHaveBeenCalled();
    });
  });
});
