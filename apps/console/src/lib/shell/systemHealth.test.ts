import { TWIN_UNAVAILABLE_COPY, type TwinCapability } from '../twin-core/twinCapability';
import { CONNECTION_LABEL, TELEMETRY_LABEL } from './connectionLabels';
import {
  HEALTHY_SUMMARY,
  SESSION_EXPIRED_SUMMARY,
  systemHealth,
  type SystemHealthInput,
} from './systemHealth';

const good: SystemHealthInput = {
  connection: 'live',
  telemetry: 'live',
  sessionExpired: false,
  twin: { available: true },
  view: '3d',
};

/** `good` with the facts that differ: each case then reads as the one thing that is wrong. */
const given = (patch: Partial<SystemHealthInput>): SystemHealthInput => ({ ...good, ...patch });

const unavailable = (reason: string) => ({ available: false, reason }) as unknown as TwinCapability;

describe('systemHealth', () => {
  it('is healthy when every fact is good', () => {
    expect(systemHealth(good)).toEqual({
      level: 'healthy',
      summary: 'System healthy',
      segments: {
        events: { label: 'Events', state: 'ok', text: 'Live' },
        telemetry: { label: 'Telemetry', state: 'ok', text: 'Live' },
        engine: { label: '3D', state: 'ok', text: '3D view' },
      },
    });
    expect(HEALTHY_SUMMARY).toBe('System healthy');
  });

  it('is healthy in 2D when the operator chose it on a device that could draw 3D', () => {
    const health = systemHealth(given({ view: '2d' }));

    expect(health.level).toBe('healthy');
    expect(health.segments.engine).toEqual({ label: '3D', state: 'ok', text: '2D map' });
  });

  describe('a single failure', () => {
    it.each([
      ['events reconnecting', { connection: 'reconnecting' }, 'Reconnecting…', 'events', 'warn'],
      ['events offline', { connection: 'offline' }, 'Offline', 'events', 'off'],
      [
        'telemetry reconnecting',
        { telemetry: 'reconnecting' },
        'Telemetry reconnecting…',
        'telemetry',
        'warn',
      ],
      ['telemetry paused', { telemetry: 'paused' }, 'Telemetry paused', 'telemetry', 'warn'],
      [
        'telemetry unavailable',
        { telemetry: 'unavailable' },
        'Telemetry unavailable',
        'telemetry',
        'off',
      ],
      [
        '3D lost its context',
        { twin: unavailable('context-lost') },
        '3D view stopped working',
        'engine',
        'warn',
      ],
      ['3D too slow', { twin: unavailable('too-slow') }, '3D view was too slow', 'engine', 'warn'],
    ] as const)('degrades the level and says so: %s', (_name, patch, summary, segment, state) => {
      const health = systemHealth(given(patch));

      expect(health.level).toBe('degraded');
      expect(health.summary).toBe(summary);
      expect(health.segments[segment]).toMatchObject({ state, text: summary });
    });

    it('degrades the level on an expired session, with every segment still ok', () => {
      const health = systemHealth(given({ sessionExpired: true }));

      expect(health.level).toBe('degraded');
      expect(health.summary).toBe('Session expired');
      expect(SESSION_EXPIRED_SUMMARY).toBe('Session expired');
      expect(Object.values(health.segments).map((segment) => segment.state)).toEqual([
        'ok',
        'ok',
        'ok',
      ]);
    });
  });

  describe('a link being made', () => {
    it('is not a problem: the first connect is not bad news', () => {
      const health = systemHealth(given({ connection: 'connecting', telemetry: 'connecting' }));

      expect(health.level).toBe('healthy');
      expect(health.summary).toBe('System healthy');
      expect(health.segments.events).toMatchObject({ state: 'ok', text: 'Connecting…' });
      expect(health.segments.telemetry).toMatchObject({
        state: 'ok',
        text: 'Telemetry connecting…',
      });
    });
  });

  describe('a device without WebGL 2', () => {
    const noWebgl2 = { available: false, reason: 'no-webgl2' } as const;

    it('is a limit, not a fault: the engine is off and the level stays healthy', () => {
      const health = systemHealth(given({ twin: noWebgl2, view: '2d' }));

      expect(health.level).toBe('healthy');
      expect(health.summary).toBe('System healthy');
      expect(health.segments.engine).toEqual({
        label: '3D',
        state: 'off',
        text: TWIN_UNAVAILABLE_COPY['no-webgl2'].title,
      });
    });

    it('never becomes the summary of another problem', () => {
      const health = systemHealth(given({ twin: noWebgl2, view: '2d', telemetry: 'paused' }));

      expect(health.level).toBe('degraded');
      expect(health.summary).toBe('Telemetry paused');
    });
  });

  describe('several failures', () => {
    it('summarises the first in the order session, events, telemetry, engine', () => {
      const fault = unavailable('too-slow');

      expect(
        systemHealth(given({ sessionExpired: true, connection: 'offline', telemetry: 'paused' }))
          .summary,
      ).toBe('Session expired');
      expect(
        systemHealth(given({ connection: 'offline', telemetry: 'paused', twin: fault })).summary,
      ).toBe('Offline');
      expect(systemHealth(given({ telemetry: 'paused', twin: fault })).summary).toBe(
        'Telemetry paused',
      );
      expect(systemHealth(given({ twin: fault })).summary).toBe('3D view was too slow');
    });

    it('still shows every segment in its own state', () => {
      const health = systemHealth(
        given({
          sessionExpired: true,
          connection: 'offline',
          telemetry: 'paused',
          twin: unavailable('context-lost'),
        }),
      );

      expect(health.summary).toBe('Session expired');
      expect(health.segments.events.state).toBe('off');
      expect(health.segments.telemetry.state).toBe('warn');
      expect(health.segments.engine.state).toBe('warn');
    });
  });

  describe('the 3D engine', () => {
    it.each(['no-webgl2', 'context-lost', 'too-slow'] as const)(
      'says %s in the twin copy’s own title',
      (reason) => {
        const health = systemHealth(given({ twin: { available: false, reason } }));

        expect(health.segments.engine.text).toBe(TWIN_UNAVAILABLE_COPY[reason].title);
      },
    );

    it('falls back to "3D unavailable" for a reason this build does not know', () => {
      const health = systemHealth(given({ twin: unavailable('a-later-fault') }));

      expect(health.level).toBe('degraded');
      expect(health.summary).toBe('3D unavailable');
      expect(health.segments.engine).toEqual({
        label: '3D',
        state: 'warn',
        text: '3D unavailable',
      });
    });

    it('does not read a key of the object prototype as a reason', () => {
      const health = systemHealth(given({ twin: unavailable('constructor') }));

      expect(health.segments.engine.text).toBe('3D unavailable');
    });
  });

  describe('the words', () => {
    it.each(Object.entries(CONNECTION_LABEL))(
      'say the events state %s in the pill’s word',
      (connection, word) => {
        const { events } = systemHealth(
          given({ connection: connection as SystemHealthInput['connection'] }),
        ).segments;

        expect(events.text).toBe(word);
      },
    );

    it.each(Object.entries(TELEMETRY_LABEL).filter(([state]) => state !== 'live'))(
      'say the telemetry state %s in the pill’s word',
      (telemetry, word) => {
        const { telemetry: segment } = systemHealth(
          given({ telemetry: telemetry as SystemHealthInput['telemetry'] }),
        ).segments;

        expect(segment.text).toBe(word);
      },
    );

    it('say a live telemetry link "Live", not the pill’s "Telemetry", which would repeat the label', () => {
      const { telemetry } = systemHealth(good).segments;

      expect(TELEMETRY_LABEL.live).toBe('Telemetry');
      expect(telemetry).toMatchObject({ label: 'Telemetry', text: 'Live' });
    });
  });

  it('is pure: it leaves its input alone and returns a new result each time', () => {
    const input = Object.freeze(given({ connection: 'offline' }));

    const first = systemHealth(input);
    const second = systemHealth(input);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(input).toEqual(given({ connection: 'offline' }));
  });
});
