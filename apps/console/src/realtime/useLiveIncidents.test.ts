import {
  type Asset,
  type AssetDetail,
  EVENTS_NAMESPACE,
  EventsConnectErrors,
  type Incident,
  type IncidentDetail,
  IncidentEvents,
  type TelemetryPoint,
  type Zone,
} from '@occ/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, render, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { io } from 'socket.io-client';
import { queryKeys } from '../api/queries';
import { getAccessToken, renewSession } from '../auth/session';
import { useSession } from '../auth/store';
import type * as CriticalCue from '../lib/criticalCue';
import { playCriticalCue } from '../lib/criticalCue';
import { registerTwinCommands, type TwinCommands } from '../lib/twinCommands';
import { useConsole } from '../store';
import { createTestQueryClient, queryWrapper, resetStore } from '../test-utils';
import { ToastRegion } from '../ui/Toast';
import { dismissToast, showToast, useToasts } from '../ui/toasts';
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

    it('remembers when the live link was lost until it is back', () => {
      const offlineSince = () => useConsole.getState().offlineSince;
      renderLive();
      socket.fire('connect');
      expect(offlineSince()).toBeNull();

      vi.setSystemTime(10_000);
      socket.fire('disconnect');
      expect(offlineSince()).toBe(10_000);

      vi.setSystemTime(20_000);
      socket.fireManager('reconnect_attempt');
      expect(offlineSince()).toBe(10_000);

      socket.fire('connect');
      expect(offlineSince()).toBeNull();
    });

    it('counts a refused first connect as offline', () => {
      renderLive();
      vi.setSystemTime(30_000);

      refuse(EventsConnectErrors.Unauthorized);

      expect(connection()).toBe('offline');
      expect(useConsole.getState().offlineSince).toBe(30_000);
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

    // The Incidents layer can be hidden by the operator (V2-10.2); a new critical incident is the
    // one thing that turns it back on without being asked.
    describe('the incidents layer', () => {
      const critical: Incident = { ...incident, severity: 'critical' };

      beforeEach(() => useConsole.getState().toggleLayer('incidents'));

      it('is shown again by a new critical incident', () => {
        renderLive();

        socket.fire(IncidentEvents.Created, critical);

        expect(useConsole.getState().layers.incidents).toBe(true);
      });

      it('leaves the other layers as the operator set them', () => {
        useConsole.getState().toggleLayer('cameras');
        renderLive();

        socket.fire(IncidentEvents.Created, critical);

        expect(useConsole.getState().layers).toEqual({
          incidents: true,
          cameras: false,
          assets: true,
          inside: true,
          heat: false,
        });
      });

      it('stays hidden for a new incident that is not critical', () => {
        renderLive();

        socket.fire(IncidentEvents.Created, { ...incident, severity: 'high' });

        expect(useConsole.getState().layers.incidents).toBe(false);
      });

      it('stays hidden for an update of a critical incident', () => {
        renderLive();

        socket.fire(IncidentEvents.Updated, critical);

        expect(useConsole.getState().layers.incidents).toBe(false);
      });
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

    /** A rig that records every command, registered for the case and taken away after it. */
    const rigs: (() => void)[] = [];
    const fakeRig = () => {
      const commands = {
        flyTo: vi.fn<TwinCommands['flyTo']>(),
        home: vi.fn<TwinCommands['home']>(),
        fit: vi.fn<TwinCommands['fit']>(),
        fitAsset: vi.fn<TwinCommands['fitAsset']>(),
        flyToIncident: vi.fn<TwinCommands['flyToIncident']>(),
        showAsset: vi.fn<TwinCommands['showAsset']>(),
        zoomBy: vi.fn<TwinCommands['zoomBy']>(),
        rotateBy: vi.fn<TwinCommands['rotateBy']>(),
        tiltBy: vi.fn<TwinCommands['tiltBy']>(),
        panBy: vi.fn<TwinCommands['panBy']>(),
        faceNorth: vi.fn<TwinCommands['faceNorth']>(),
        current: vi.fn<TwinCommands['current']>(() => null),
      } satisfies TwinCommands;
      rigs.push(registerTwinCommands(commands));
      return commands;
    };
    /** How many camera commands were issued, `current()` (a read) not counted. */
    const commandCalls = (rig: ReturnType<typeof fakeRig>) =>
      Object.entries(rig)
        .filter(([name]) => name !== 'current')
        .reduce((total, [, spy]) => total + spy.mock.calls.length, 0);

    afterEach(() => rigs.splice(0).forEach((unregister) => unregister()));

    beforeEach(() => client.setQueryData(queryKeys.zones, [zone]));

    // A video wall screen (V2-21.2) has no toast region to show or clear a toast and nobody to unlock audio: it still
    // takes the incident, which is the list's and the wall's to show.
    it('makes no toast and no sound on a video wall screen, and still takes the incident', () => {
      useConsole.setState({ wall: 1, criticalSound: true });
      renderLive();

      socket.fire(IncidentEvents.Created, critical);

      expect(toasts()).toEqual([]);
      expect(playCriticalCue).not.toHaveBeenCalled();
      expect(client.getQueryData<Incident[]>(queryKeys.incidents)).toEqual([critical]);
    });

    it('shows an urgent toast for a new critical incident', () => {
      renderLive();

      socket.fire(IncidentEvents.Created, critical);

      expect(toasts()).toEqual([
        expect.objectContaining({
          key: 'incident-1',
          urgent: true,
          severity: 'critical',
          kicker: 'New critical · Medical emergency',
          title: 'Person down at entrance',
          detail: 'Main Gate · INC-000042 · just now',
          action: expect.objectContaining({ label: 'View incident' }),
        }),
      ]);
    });

    describe('in the 3D view (V2-16.5)', () => {
      beforeEach(() => useConsole.setState({ view: '3d' }));

      it.each(['critical', 'high'] as const)(
        'offers "Fly to" and "Open incident" for a new %s incident',
        (severity) => {
          renderLive();

          socket.fire(IncidentEvents.Created, { ...incident, severity });

          expect(toasts()).toEqual([
            expect.objectContaining({
              action: { label: 'Fly to', onAction: expect.any(Function) },
              secondaryAction: { label: 'Open incident', onAction: expect.any(Function) },
            }),
          ]);
        },
      );

      it('moves the camera for nothing on arrival, and "Fly to" asks for the flight once, after the selection', () => {
        const rig = fakeRig();
        renderLive();

        socket.fire(IncidentEvents.Created, critical);
        expect(commandCalls(rig)).toBe(0);

        toasts()[0]!.action!.onAction();

        expect(rig.flyToIncident).toHaveBeenCalledExactlyOnceWith('incident-1');
        expect(useConsole.getState().selectedIncidentId).toBe('incident-1');
      });

      it('leaves the toast of a reporter’s own incident alone: no second toast', () => {
        renderLive();
        showToast({ key: 'incident-1', title: 'Reported INC-000042' });

        socket.fire(IncidentEvents.Created, critical);

        expect(toasts().map((toast) => toast.title)).toEqual(['Reported INC-000042']);
      });
    });

    describe('in the 2D view', () => {
      beforeEach(() => useConsole.setState({ view: '2d' }));

      it('keeps the single "View incident" action for a new critical and a new high incident', () => {
        renderLive();

        socket.fire(IncidentEvents.Created, critical);
        socket.fire(IncidentEvents.Created, { ...incident, id: 'incident-2', severity: 'high' });

        for (const toast of toasts()) {
          expect(toast.action?.label).toBe('View incident');
          expect(toast).not.toHaveProperty('secondaryAction');
        }
        expect(toasts()).toHaveLength(2);
      });
    });

    it('reads a new critical incident out at once', () => {
      renderLive();
      const { container } = render(createElement(ToastRegion));

      // In `act`, so the region re-renders before the assertions; the event comes from outside React.
      act(() => socket.fire(IncidentEvents.Created, critical));

      const assertive = container.querySelector('[aria-live="assertive"]');
      const polite = container.querySelector('[aria-live="polite"]');
      expect(assertive).toHaveTextContent('New critical · Medical emergency');
      expect(assertive).toHaveTextContent('Person down at entrance');
      expect(polite).toBeEmptyDOMElement();
    });

    it('shows a toast that goes by itself for a new high incident, read out politely', () => {
      renderLive();
      const { container } = render(createElement(ToastRegion));

      act(() => socket.fire(IncidentEvents.Created, incident));

      expect(toasts()).toEqual([
        expect.objectContaining({ kicker: 'New high · Medical emergency', severity: 'high' }),
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

    // The event has no timeline, so the toast of a telemetry incident gets its reading afterwards,
    // from the incident's detail (V2-11.4): the same toast, no second sound.
    describe('a telemetry incident', () => {
      const MOTOR: TelemetryPoint = {
        key: 'motorTempC',
        label: 'Motor temperature',
        unit: '°C',
        kind: 'number',
        min: -40,
        max: 150,
        enumValues: null,
        expectedIntervalS: 1,
        headline: 2,
      };
      const VIBRATION: TelemetryPoint = {
        ...MOTOR,
        key: 'vibrationMms',
        label: 'Vibration',
        unit: 'mm/s',
        headline: null,
      };
      /** The catalogue's entry: it has the headline points only. */
      const tower = {
        id: 'asset-ct-01',
        code: 'CT-01',
        name: 'Cooling tower 1',
        elevationM: 0,
        headline: [MOTOR],
      } as unknown as Asset;

      const raised: Incident = {
        ...incident,
        type: 'equipment_fault',
        severity: 'critical',
        source: 'telemetry',
        assetId: tower.id,
        title: 'Motor over-temperature — Cooling tower 1',
      };
      const detailWith = (note: string | null): IncidentDetail => ({
        ...raised,
        timeline: [
          {
            id: 'event-1',
            kind: 'reported',
            note,
            at: '2026-10-01T08:00:00.000Z',
            actor: { kind: 'system', subject: 'telemetry', displayName: 'Telemetry rule' },
          },
        ],
      });

      const fetchMock = vi.fn<typeof fetch>();
      const answer = (detail: IncidentDetail) =>
        fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(detail))));
      /**
       * Lets the detail request come back: `fetchQuery` settles on microtasks, and reading the body
       * of a `Response` takes a few turns of the event loop, which the fake clock yields to.
       */
      const settle = () =>
        act(async () => {
          for (let turn = 0; turn < 5; turn++) await vi.advanceTimersByTimeAsync(0);
        });

      beforeEach(() => {
        fetchMock.mockReset();
        answer(detailWith('motorTempC 92 > 85 for 60 s'));
        vi.stubGlobal('fetch', fetchMock);
        client.setQueryData(queryKeys.assets, [tower]);
      });

      afterEach(() => vi.unstubAllGlobals());

      it('shows the toast at once, with the asset and no reading yet', () => {
        renderLive();

        socket.fire(IncidentEvents.Created, raised);

        expect(toasts()).toEqual([
          expect.objectContaining({
            key: 'incident-1',
            urgent: true,
            severity: 'critical',
            kicker: 'Critical · raised by telemetry rule',
            title: 'Motor over-temperature — Cooling tower 1',
            detail: 'CT-01 · Main Gate',
            action: expect.objectContaining({ label: 'View incident' }),
          }),
        ]);
      });

      it('adds the reading to the same toast, with one request and without moving the view', async () => {
        renderLive();
        socket.fire(IncidentEvents.Created, raised);
        const [first] = toasts();

        await settle();

        expect(toasts()).toEqual([
          { ...first, detail: 'CT-01 · Main Gate · 92 °C for 60 s, limit 85 °C' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/incidents\/incident-1$/);
        expect(useConsole.getState().selectedIncidentId).toBeNull();
      });

      it('plays the sound once, not again when the reading arrives', async () => {
        useConsole.setState({ criticalSound: true });
        renderLive();

        socket.fire(IncidentEvents.Created, raised);
        await settle();

        expect(playCriticalCue).toHaveBeenCalledTimes(1);
      });

      it('enriches a high incident too, which stays a polite toast without a sound', async () => {
        useConsole.setState({ criticalSound: true });
        renderLive();

        socket.fire(IncidentEvents.Created, { ...raised, severity: 'high' });
        await settle();

        expect(toasts()).toEqual([
          expect.objectContaining({
            kicker: 'High · raised by telemetry rule',
            urgent: false,
            detail: 'CT-01 · Main Gate · 92 °C for 60 s, limit 85 °C',
          }),
        ]);
        expect(playCriticalCue).not.toHaveBeenCalled();
      });

      it('names the zone and the incident while the catalogue is not loaded, and still adds the reading', async () => {
        client.removeQueries({ queryKey: queryKeys.assets });
        renderLive();

        socket.fire(IncidentEvents.Created, raised);
        expect(toasts()[0]!.detail).toBe('Main Gate · INC-000042');
        await settle();

        expect(toasts()[0]!.detail).toBe('Main Gate · INC-000042 · 92 for 60 s, limit 85');
      });

      it('uses the catalogue when it loaded while the detail was on its way', async () => {
        client.removeQueries({ queryKey: queryKeys.assets });
        renderLive();
        socket.fire(IncidentEvents.Created, raised);

        client.setQueryData(queryKeys.assets, [tower]);
        await settle();

        expect(toasts()[0]!.detail).toBe('CT-01 · Main Gate · 92 °C for 60 s, limit 85 °C');
      });

      it('takes the unit of a point the catalogue does not carry from a cached asset detail', async () => {
        answer(detailWith('vibrationMms 7.4 > 7.1 for 120 s'));
        client.setQueryData(queryKeys.asset('CT-01'), {
          ...tower,
          points: [MOTOR, VIBRATION],
          rules: [],
        } as unknown as AssetDetail);
        renderLive();

        socket.fire(IncidentEvents.Created, raised);
        await settle();

        expect(toasts()[0]!.detail).toBe('CT-01 · Main Gate · 7.4 mm/s for 2 min, limit 7.1 mm/s');
      });

      it('leaves the first toast when the detail cannot be loaded', async () => {
        fetchMock.mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ message: 'Boom' }), { status: 500 })),
        );
        renderLive();
        socket.fire(IncidentEvents.Created, raised);
        const [first] = toasts();

        await settle();

        expect(toasts()).toEqual([first]);
      });

      it.each([
        ['an operator’s note', 'Technician on the way'],
        ['no note', null],
      ])('leaves the first toast when the first entry holds %s', async (_name, note) => {
        answer(detailWith(note));
        renderLive();
        socket.fire(IncidentEvents.Created, raised);
        const [first] = toasts();

        await settle();

        expect(toasts()).toEqual([first]);
      });

      it('does not bring the toast back when the operator dismissed it meanwhile', async () => {
        renderLive();
        socket.fire(IncidentEvents.Created, raised);

        dismissToast(toasts()[0]!.id);
        await settle();

        expect(toasts()).toEqual([]);
      });

      it('adds nothing once the hook is gone', async () => {
        const { unmount } = renderLive();
        socket.fire(IncidentEvents.Created, raised);
        const [first] = toasts();

        unmount();
        await settle();

        expect(toasts()).toEqual([first]);
      });

      // V2-11.5, changed on purpose by V2-16.5. The toast does not depend on the role: in the 3D view every role gets
      // "Fly to" and "Open incident" (both only read), in 2D the one "View incident". This is the table the V2-11.5
      // comment said would change with V2-16.
      describe.each(['operator', 'supervisor', 'technician', 'viewer'] as const)(
        'for a %s',
        (role) => {
          beforeEach(() => {
            useSession.getState().signedIn({ displayName: 'Signed-in user', roles: [role] });
            useConsole.setState({ criticalSound: true });
          });

          afterEach(() => resetStore(useSession));

          describe('in the 3D view', () => {
            beforeEach(() => useConsole.setState({ view: '3d' }));

            it('shows the same toast, with "Fly to" and "Open incident"', async () => {
              renderLive();

              socket.fire(IncidentEvents.Created, raised);
              await settle();

              expect(toasts()).toEqual([
                expect.objectContaining({
                  kicker: 'Critical · raised by telemetry rule',
                  urgent: true,
                  detail: 'CT-01 · Main Gate · 92 °C for 60 s, limit 85 °C',
                  action: { label: 'Fly to', onAction: expect.any(Function) },
                  secondaryAction: { label: 'Open incident', onAction: expect.any(Function) },
                }),
              ]);
              expect(playCriticalCue).toHaveBeenCalledTimes(1);
            });

            it('opens the incident from "Open incident" and moves the camera for nothing', async () => {
              const rig = fakeRig();
              renderLive();
              socket.fire(IncidentEvents.Created, raised);
              await settle();

              toasts()[0]!.secondaryAction!.onAction();

              expect(useConsole.getState()).toMatchObject({
                selectedIncidentId: 'incident-1',
                selectedAssetCode: null,
                reporting: false,
              });
              expect(commandCalls(rig)).toBe(0);
            });

            it('selects the incident and then flies to its beacon from "Fly to"', async () => {
              const rig = fakeRig();
              let selectedAtTheFlight: string | null = null;
              rig.flyToIncident.mockImplementation(() => {
                selectedAtTheFlight = useConsole.getState().selectedIncidentId;
              });
              renderLive();
              socket.fire(IncidentEvents.Created, raised);
              await settle();

              toasts()[0]!.action!.onAction();

              expect(rig.flyToIncident).toHaveBeenCalledTimes(1);
              expect(rig.flyToIncident).toHaveBeenCalledWith('incident-1');
              // The selection comes first, so the flight replaces any flight the selection starts.
              expect(selectedAtTheFlight).toBe('incident-1');
              expect(commandCalls(rig)).toBe(1);
            });
          });

          describe('in the 2D view', () => {
            beforeEach(() => useConsole.setState({ view: '2d' }));

            it('shows the same toast, with the one "View incident" action and no "Fly to"', async () => {
              renderLive();

              socket.fire(IncidentEvents.Created, raised);
              await settle();

              expect(toasts()).toEqual([
                expect.objectContaining({
                  kicker: 'Critical · raised by telemetry rule',
                  urgent: true,
                  detail: 'CT-01 · Main Gate · 92 °C for 60 s, limit 85 °C',
                  action: { label: 'View incident', onAction: expect.any(Function) },
                }),
              ]);
              expect(toasts()[0]).not.toHaveProperty('secondaryAction');
              expect(playCriticalCue).toHaveBeenCalledTimes(1);
            });

            it('opens the incident from the toast and nothing else', async () => {
              const rig = fakeRig();
              renderLive();
              socket.fire(IncidentEvents.Created, raised);
              await settle();

              toasts()[0]!.action!.onAction();

              expect(useConsole.getState()).toMatchObject({
                selectedIncidentId: 'incident-1',
                selectedAssetCode: null,
                reporting: false,
              });
              expect(commandCalls(rig)).toBe(0);
            });
          });
        },
      );

      // V2-16.5. The camera is the operator's: an arrival, its reading and its sound move nothing (Principle 4).
      describe('in the 3D view, whatever arrives', () => {
        beforeEach(() => useConsole.setState({ view: '3d' }));

        it('moves the camera for nothing when the incident arrives or when its reading is added', async () => {
          const rig = fakeRig();
          renderLive();

          socket.fire(IncidentEvents.Created, raised);
          expect(commandCalls(rig)).toBe(0);
          await settle();

          expect(toasts()[0]!.detail).toContain('92 °C for 60 s');
          expect(commandCalls(rig)).toBe(0);
        });

        it('keeps "Fly to" and "Open incident" when the reading is added to the same toast', async () => {
          renderLive();
          socket.fire(IncidentEvents.Created, raised);
          const before = toasts()[0]!;
          expect(before.action?.label).toBe('Fly to');
          expect(before.detail).toBe('CT-01 · Main Gate');

          await settle();

          const after = toasts()[0]!;
          expect(after.id).toBe(before.id);
          expect(after.detail).toBe('CT-01 · Main Gate · 92 °C for 60 s, limit 85 °C');
          expect(after.action?.label).toBe('Fly to');
          expect(after.secondaryAction?.label).toBe('Open incident');
        });

        it('still selects, and fails nothing, when the view was switched to 2D while the toast was up', async () => {
          renderLive();
          socket.fire(IncidentEvents.Created, raised);
          await settle();
          useConsole.setState({ view: '2d' });

          // No stage is mounted in 2D, so no rig is registered: the flight is a no-op.
          expect(() => toasts()[0]!.action!.onAction()).not.toThrow();

          expect(useConsole.getState().selectedIncidentId).toBe('incident-1');
        });
      });

      it('asks for nothing for an incident a person reported', async () => {
        renderLive();

        socket.fire(IncidentEvents.Created, { ...raised, source: 'operator', assetId: null });
        await settle();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(toasts()[0]).toMatchObject({
          kicker: 'New critical · Equipment fault',
          detail: 'Main Gate · INC-000042 · just now',
        });
      });

      it('asks for nothing for an incident that gets no toast', async () => {
        renderLive();

        socket.fire(IncidentEvents.Created, { ...raised, severity: 'medium' });
        await settle();

        expect(fetchMock).not.toHaveBeenCalled();
        expect(toasts()).toEqual([]);
      });
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
