import {
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type Incident,
  IncidentEvents,
  type Zone,
} from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { io } from 'socket.io-client';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import type * as CriticalCue from '../lib/criticalCue';
import { playCriticalCue } from '../lib/criticalCue';
import { useConsole } from '../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../test-utils';
import { ToastRegion } from '../ui/Toast';
import { showToast, useToasts } from '../ui/toasts';
import { useLiveIncidents } from './useLiveIncidents';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('../auth/session', () => ({ getAccessToken: vi.fn(), renewSession: vi.fn() }));
// The store reads and writes the sound preference through the real module; only the sound is faked.
vi.mock('../lib/criticalCue', async (importOriginal) => ({
  ...(await importOriginal<typeof CriticalCue>()),
  playCriticalCue: vi.fn(),
}));

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
    resetStore(useToasts);
    vi.mocked(playCriticalCue).mockReset();
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
    it('starts as connecting, before the first connect', () => {
      renderLive();

      expect(connection()).toBe('connecting');
      expect(useConsole.getState().lastEventAt).toBeNull();
    });

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

      expect(connection()).toBe('reconnecting');
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

  // A new critical or high incident is announced with a toast (frame 04); critical can also sound.
  describe('attention', () => {
    const zone: Zone = {
      id: incident.zoneId,
      code: 'Z-GATE',
      name: 'Main Gate',
      kind: 'gate',
      polygon: [],
      center: [108.44, 11.95],
    };
    const critical: Incident = { ...incident, severity: 'critical' };
    const toasts = () => useToasts.getState().toasts;

    beforeEach(() => client.setQueryData(queryKeys.zones, [zone]));

    it('shows an urgent toast for a new critical incident', () => {
      renderLive();

      socket.fire(IncidentEvents.Created, critical);

      expect(toasts()).toEqual([
        expect.objectContaining({
          key: 'incident-1',
          urgent: true,
          severity: 'critical',
          kicker: 'New critical · Medical',
          title: 'Person down at entrance',
          detail: 'Main Gate · INC-000042 · just now',
          action: expect.objectContaining({ label: 'View incident' }),
        }),
      ]);
    });

    it('reads a new critical incident out at once', () => {
      renderLive();
      const { container } = render(createElement(ToastRegion));

      // In `act`, so the region re-renders before the assertions; the event comes from outside React.
      act(() => socket.fire(IncidentEvents.Created, critical));

      const assertive = container.querySelector('[aria-live="assertive"]');
      const polite = container.querySelector('[aria-live="polite"]');
      expect(assertive).toHaveTextContent('New critical · Medical');
      expect(assertive).toHaveTextContent('Person down at entrance');
      expect(polite).toBeEmptyDOMElement();
    });

    it('shows a toast that goes by itself for a new high incident, read out politely', () => {
      renderLive();
      const { container } = render(createElement(ToastRegion));

      act(() => socket.fire(IncidentEvents.Created, incident));

      expect(toasts()).toEqual([
        expect.objectContaining({ kicker: 'New high · Medical', severity: 'high' }),
      ]);
      expect(toasts()[0]!.urgent).toBeFalsy();
      expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
        'Person down at entrance',
      );
      expect(container.querySelector('[aria-live="assertive"]')).toBeEmptyDOMElement();
    });

    it.each(['medium', 'low'] as const)(
      'shows no toast for a new %s incident, which only stands out in the feed',
      (severity) => {
        renderLive();

        socket.fire(IncidentEvents.Created, { ...incident, severity });

        expect(toasts()).toEqual([]);
        expect(useConsole.getState().fresh.has(incident.id)).toBe(true);
      },
    );

    it('leaves the zone out while the zones are not loaded', () => {
      client.removeQueries({ queryKey: queryKeys.zones });
      renderLive();

      socket.fire(IncidentEvents.Created, critical);

      expect(toasts()[0]!.detail).toBe('INC-000042 · just now');
    });

    // The operator's own report also arrives as `Created`; its "Reported …" toast is enough.
    it('adds no toast and no sound when a toast about the incident is already shown', () => {
      useConsole.setState({ criticalSound: true });
      showToast({ key: 'incident-1', title: 'Reported INC-000042' });
      renderLive();

      socket.fire(IncidentEvents.Created, critical);

      expect(toasts()).toEqual([expect.objectContaining({ title: 'Reported INC-000042' })]);
      expect(playCriticalCue).not.toHaveBeenCalled();
    });

    describe('sound', () => {
      it('plays for a new critical incident when it is on', () => {
        useConsole.setState({ criticalSound: true });
        renderLive();

        socket.fire(IncidentEvents.Created, critical);

        expect(playCriticalCue).toHaveBeenCalledTimes(1);
      });

      it('stays silent when it is off, the default', () => {
        renderLive();

        socket.fire(IncidentEvents.Created, critical);

        expect(playCriticalCue).not.toHaveBeenCalled();
      });

      it('stays silent for a high incident', () => {
        useConsole.setState({ criticalSound: true });
        renderLive();

        socket.fire(IncidentEvents.Created, incident);

        expect(playCriticalCue).not.toHaveBeenCalled();
      });
    });

    it('opens the incident from the toast', () => {
      renderLive();
      socket.fire(IncidentEvents.Created, critical);

      toasts()[0]!.action!.onAction();

      expect(useConsole.getState().selectedIncidentId).toBe('incident-1');
    });

    it.each(['acknowledged', 'resolved'] as const)(
      'stops treating an incident as fresh once it is %s',
      (status) => {
        renderLive();
        socket.fire(IncidentEvents.Created, incident);

        socket.fire(IncidentEvents.Updated, { ...incident, status, version: 2 });

        expect(useConsole.getState().fresh.has(incident.id)).toBe(false);
      },
    );
  });

  // The header shows how long ago the link last answered; a growing age is the warning.
  describe('signs of life', () => {
    const t = new Date('2026-10-06T08:00:00Z');
    const lastEventAt = () => useConsole.getState().lastEventAt;

    it('records one on connect', () => {
      renderLive();
      vi.setSystemTime(t);

      socket.fire('connect');

      expect(lastEventAt()).toBe(t.getTime());
    });

    it("records one on the server's heartbeat", () => {
      renderLive();
      vi.setSystemTime(t);
      socket.fire('connect');

      vi.setSystemTime(t.getTime() + 25_000);
      socket.fireManager('ping');

      expect(lastEventAt()).toBe(t.getTime() + 25_000);
    });

    it.each([IncidentEvents.Created, IncidentEvents.Updated])('records one on %s', (event) => {
      renderLive();
      vi.setSystemTime(t);

      socket.fire(event, incident);

      expect(lastEventAt()).toBe(t.getTime());
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

    it('retries a forbidden connection after a second, without renewing', async () => {
      renderLive();

      refuse(EventsConnectErrors.Forbidden);
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
