import type { TelemetryPoint, TelemetryRule } from '@occ/contracts';
import {
  drawnSeries,
  encodedLatest,
  freshnessText,
  inspectorRows,
  inspectorStateText,
  overSeverity,
  readingIsStale,
  SPARKLINE_WINDOW_MS,
} from './assetInspector';

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: null,
  ...overrides,
});

const rule = (overrides: Partial<TelemetryRule> = {}): TelemetryRule => ({
  name: 'Motor over temperature',
  key: 'motorTempC',
  comparator: 'above',
  limit: 85,
  clear: 80,
  forS: 5,
  severity: 'critical',
  incidentType: 'equipment_fault',
  ...overrides,
});

const RECEIVED = '2026-10-15T08:00:00.000Z';
const RECEIVED_MS = Date.parse(RECEIVED);

describe('inspectorRows', () => {
  it('puts the headline points first by rank, then the ruled points, then the rest', () => {
    const rows = inspectorRows(
      [
        point({ key: 'setpoint' }),
        point({ key: 'vibration' }),
        point({ key: 'temp', headline: 2 }),
        point({ key: 'fan', headline: 1 }),
        point({ key: 'current' }),
      ],
      [rule({ key: 'current' }), rule({ key: 'vibration' })],
    );

    // Ruled points keep the catalogue's order, not the rules'.
    expect(rows.main.map((row) => row.point.key)).toEqual(['fan', 'temp', 'vibration', 'current']);
    expect(rows.more.map((row) => row.point.key)).toEqual(['setpoint']);
  });

  it('gives a point its rule, the first one for its key, or none', () => {
    const first = rule({ key: 'temp', name: 'First' });
    const rows = inspectorRows(
      [point({ key: 'temp', headline: 1 }), point({ key: 'fan', headline: 2 })],
      [first, rule({ key: 'temp', name: 'Second' })],
    );

    expect(rows.main[0]?.rule).toBe(first);
    expect(rows.main[1]?.rule).toBeNull();
  });

  it('keeps a point of a kind this console does not know', () => {
    const odd = point({ key: 'odd', kind: 'quantum' as TelemetryPoint['kind'] });

    expect(inspectorRows([odd], []).more.map((row) => row.point)).toEqual([odd]);
  });

  it('is empty for a class with no points', () => {
    expect(inspectorRows([], [])).toEqual({ main: [], more: [] });
  });
});

describe('encodedLatest', () => {
  it('is a number as it is and a boolean as 0 / 1', () => {
    expect(encodedLatest(point(), 71.2)).toBe(71.2);
    expect(encodedLatest(point(), true)).toBe(1);
    expect(encodedLatest(point(), false)).toBe(0);
  });

  it('is an enum value as its index, and null without enum values', () => {
    const mode = point({ kind: 'enum', enumValues: ['off', 'manual', 'auto'] });

    expect(encodedLatest(mode, 'auto')).toBe(2);
    expect(encodedLatest(mode, 'unknown')).toBeNull();
    expect(encodedLatest(point({ kind: 'enum' }), 'auto')).toBeNull();
  });

  it('is null for no value and for a value with no number', () => {
    expect(encodedLatest(point(), undefined)).toBeNull();
    expect(encodedLatest(point(), Number.NaN)).toBeNull();
  });
});

describe('drawnSeries', () => {
  const ring = { t: Float64Array.of(1_000, 2_000), v: Float32Array.of(1, 2) };

  it('appends the latest value at `to` while live', () => {
    const drawn = drawnSeries(ring, 3, 5_000, true);

    expect([...drawn.times]).toEqual([1_000, 2_000, 5_000]);
    expect([...drawn.values]).toEqual([1, 2, 3]);
  });

  it("never touches the ring's own arrays", () => {
    drawnSeries(ring, 3, 5_000, true);

    expect(ring.t).toHaveLength(2);
    expect(ring.v).toHaveLength(2);
  });

  it('does not append when stale: the chart must stop at the last reading', () => {
    const drawn = drawnSeries(ring, 3, 5_000, false);

    expect(drawn.times).toBe(ring.t);
    expect(drawn.values).toBe(ring.v);
  });

  it('does not append without a latest value', () => {
    expect(drawnSeries(ring, null, 5_000, true).times).toBe(ring.t);
  });

  it('does not append when the ring already reaches `to`', () => {
    expect(drawnSeries(ring, 3, 2_000, true).times).toBe(ring.t);
    expect(drawnSeries(ring, 3, 1_500, true).times).toBe(ring.t);
  });

  it('does not append at a time that is not a number', () => {
    expect(drawnSeries(ring, 3, Number.NaN, true).times).toBe(ring.t);
  });

  it('draws a lone latest value for a point with no series yet', () => {
    const drawn = drawnSeries(undefined, 7, 5_000, true);

    expect([...drawn.times]).toEqual([5_000]);
    expect([...drawn.values]).toEqual([7]);
  });

  it('is empty with no series and nothing to append', () => {
    const drawn = drawnSeries(undefined, null, 5_000, true);

    expect(drawn.times).toHaveLength(0);
    expect(drawn.values).toHaveLength(0);
  });
});

describe('overSeverity', () => {
  it('is the rule severity once past an `above` limit, and not at it', () => {
    expect(overSeverity(rule(), 92)).toBe('critical');
    expect(overSeverity(rule(), 85)).toBeUndefined();
    expect(overSeverity(rule(), 71)).toBeUndefined();
  });

  it('is the rule severity once under a `below` limit', () => {
    const low = rule({ comparator: 'below', limit: 20, severity: 'high' });

    expect(overSeverity(low, 15)).toBe('high');
    expect(overSeverity(low, 20)).toBeUndefined();
  });

  it("reads a boolean's encoded 0.5 as a limit its true value is above", () => {
    const wet = rule({ key: 'leakDetected', limit: 0.5, severity: 'critical' });

    expect(overSeverity(wet, 1)).toBe('critical');
    expect(overSeverity(wet, 0)).toBeUndefined();
  });

  it('is undefined without a rule or a value, or for a comparator it does not know', () => {
    expect(overSeverity(null, 92)).toBeUndefined();
    expect(overSeverity(rule(), null)).toBeUndefined();
    expect(
      overSeverity(rule({ comparator: 'between' as TelemetryRule['comparator'] }), 92),
    ).toBeUndefined();
  });
});

describe('readingIsStale', () => {
  const online = { online: true, receivedAt: RECEIVED };

  it('is stale when the device is offline, whatever the clock says', () => {
    expect(readingIsStale({ online: false, receivedAt: RECEIVED }, 5_000, RECEIVED_MS)).toBe(true);
    expect(readingIsStale({ online: false, receivedAt: RECEIVED }, null, null)).toBe(true);
  });

  it('is stale at and after the threshold, on the server clock', () => {
    expect(readingIsStale(online, 5_000, RECEIVED_MS + 4_999)).toBe(false);
    expect(readingIsStale(online, 5_000, RECEIVED_MS + 5_000)).toBe(true);
  });

  it('is not judged without a clock or a threshold', () => {
    expect(readingIsStale(online, 5_000, null)).toBe(false);
    expect(readingIsStale(online, null, RECEIVED_MS + 600_000)).toBe(false);
  });
});

describe('inspectorStateText', () => {
  const now = RECEIVED_MS + 30_000;

  it('says the state with no age for the states that have no time', () => {
    expect(inspectorStateText('fault', RECEIVED, now)).toBe('Fault');
    expect(inspectorStateText('running', RECEIVED, now)).toBe('Running');
    expect(inspectorStateText('standby', RECEIVED, now)).toBe('Standby');
  });

  it('says since when for no data and offline', () => {
    expect(inspectorStateText('nodata', RECEIVED, now)).toMatch(/^No data since \d{2}:\d{2}$/);
    expect(inspectorStateText('offline', RECEIVED, now)).toMatch(/^Offline since \d{2}:\d{2}$/);
  });

  it('drops the time it cannot give', () => {
    expect(inspectorStateText('nodata', null, now)).toBe('No data');
    expect(inspectorStateText('offline', RECEIVED, null)).toBe('Offline');
    expect(inspectorStateText('nodata', 'not a time', now)).toBe('No data');
  });

  it('says nothing for an asset it cannot judge', () => {
    expect(inspectorStateText('unknown', RECEIVED, now)).toBeNull();
  });
});

describe('freshnessText', () => {
  it('says how long ago while live and how old once stale', () => {
    expect(freshnessText(400, false)).toBe('Updated 0.4 s ago');
    expect(freshnessText(12_000, false)).toBe('Updated 12 s ago');
    expect(freshnessText(72_000, true)).toBe('1 min 12 s old');
  });

  it('says nothing with no reading to date', () => {
    expect(freshnessText(null, false)).toBeNull();
    expect(freshnessText(null, true)).toBeNull();
  });
});

describe('SPARKLINE_WINDOW_MS', () => {
  it('is the 15 minutes of a ring buffer', () => {
    expect(SPARKLINE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});
