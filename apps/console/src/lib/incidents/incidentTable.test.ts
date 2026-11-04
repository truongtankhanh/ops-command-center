import type { Incident, IncidentSeverity, IncidentSource, IncidentStatus } from '@occ/contracts';
import {
  ariaSortOf,
  nextSort,
  sortIncidents,
  TABLE_COLUMNS,
  type TableColumnKey,
  type TableSort,
} from './incidentTable';

const NOW = Date.parse('2026-11-04T08:00:00.000Z');
const MIN = 60_000;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const ZONES = new Map([
  ['z-lib', 'Library'],
  ['z-gym', 'Gym'],
  ['z-lab', 'Science Lab'],
  ['z-arena', 'Arena'],
]);
const CONTEXT = { zoneName: ZONES, now: NOW };

const incident = (id: string, overrides: Partial<Incident> = {}): Incident => ({
  id,
  code: `INC-${id}`,
  type: 'fire_alarm',
  severity: 'medium',
  status: 'open',
  title: `Incident ${id}`,
  description: null,
  zoneId: 'z-lib',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: ago(5 * MIN),
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/*
 * Four incidents whose order differs from the feed's on almost every column. The feed (`compareIncidents`: unresolved first,
 * most severe, newest) reads a, d, b, c.
 *
 * | id | code       | severity | status       | title     | place       | source    | raised  | attention (medium 15 min, critical 2) |
 * | a  | INC-000004 | critical | open         | Boîte     | Library     | telemetry | 1 min   | 1 min left                            |
 * | b  | INC-000002 | low      | acknowledged | alarm     | Gym         | operator  | 40 min  | none                                  |
 * | c  | INC-000003 | high     | resolved     | Door      | Science Lab | simulator | 30 min  | none                                  |
 * | d  | INC-000001 | medium   | open         | boiler    | Arena       | operator  | 20 min  | 5 min over                            |
 */
const A = incident('a', {
  code: 'INC-000004',
  severity: 'critical',
  title: 'Boîte',
  zoneId: 'z-lib',
  source: 'telemetry',
  reportedAt: ago(MIN),
});
const B = incident('b', {
  code: 'INC-000002',
  severity: 'low',
  status: 'acknowledged',
  title: 'alarm',
  zoneId: 'z-gym',
  reportedAt: ago(40 * MIN),
  acknowledgedAt: ago(35 * MIN),
});
const C = incident('c', {
  code: 'INC-000003',
  severity: 'high',
  status: 'resolved',
  title: 'Door',
  zoneId: 'z-lab',
  source: 'simulator',
  reportedAt: ago(30 * MIN),
  acknowledgedAt: ago(28 * MIN),
  resolvedAt: ago(25 * MIN),
});
const D = incident('d', {
  code: 'INC-000001',
  severity: 'medium',
  title: 'boiler',
  zoneId: 'z-arena',
  reportedAt: ago(20 * MIN),
});
// Given out of the feed's order, so a result in it is the sort's doing.
const ROWS: readonly Incident[] = [C, B, D, A];

const ids = (rows: readonly Incident[]): string[] => rows.map((row) => row.id);
const sorted = (sort: TableSort | null, rows: readonly Incident[] = ROWS, context = CONTEXT) =>
  ids(sortIncidents(rows, sort, context));
const asc = (key: TableColumnKey): TableSort => ({ key, direction: 'ascending' });
const desc = (key: TableColumnKey): TableSort => ({ key, direction: 'descending' });
const KEYS = TABLE_COLUMNS.map((column) => column.key);
/** A value from a newer API: a string this console's types do not list. */
const unknown = <T extends string>(value: string): T => value as T;

describe('TABLE_COLUMNS', () => {
  it("lists frame 19's headers in order, every one sortable", () => {
    expect(TABLE_COLUMNS.map(({ key, label }) => [key, label])).toEqual([
      ['severity', 'Severity'],
      ['incident', 'Incident'],
      ['place', 'Place'],
      ['status', 'Status'],
      ['source', 'Source'],
      ['raised', 'Raised'],
      ['attention', 'Attention'],
      ['code', 'Code'],
    ]);
    expect(TABLE_COLUMNS.every((column) => column.sortable)).toBe(true);
  });

  it('starts each column where an operator reads it first', () => {
    expect(
      Object.fromEntries(TABLE_COLUMNS.map((column) => [column.key, column.defaultDirection])),
    ).toEqual({
      severity: 'descending',
      incident: 'ascending',
      place: 'ascending',
      status: 'ascending',
      source: 'ascending',
      raised: 'descending',
      attention: 'ascending',
      code: 'descending',
    });
  });

  it('never calls the attention threshold an SLA', () => {
    expect(TABLE_COLUMNS.some((column) => /SLA/i.test(column.label))).toBe(false);
  });
});

describe('sortIncidents', () => {
  describe('each column', () => {
    it.each([
      ['severity', ['b', 'd', 'c', 'a'], ['a', 'c', 'd', 'b']],
      // Folded: "Boîte" is "boite", after "boiler"; case does not count.
      ['incident', ['b', 'd', 'a', 'c'], ['c', 'a', 'd', 'b']],
      ['place', ['d', 'b', 'a', 'c'], ['c', 'a', 'b', 'd']],
      // Lifecycle order; the two open ones keep the feed's order (a, d) both ways.
      ['status', ['a', 'd', 'b', 'c'], ['c', 'b', 'a', 'd']],
      // Operator, telemetry, simulator; the two operator ones keep the feed's order (d, b) both ways.
      ['source', ['d', 'b', 'a', 'c'], ['c', 'a', 'd', 'b']],
      ['raised', ['b', 'c', 'd', 'a'], ['a', 'd', 'c', 'b']],
      // Overdue first ascending; the two with no countdown last both ways, in the feed's order.
      ['attention', ['d', 'a', 'b', 'c'], ['a', 'd', 'b', 'c']],
      ['code', ['d', 'b', 'c', 'a'], ['a', 'c', 'b', 'd']],
    ] as const)('sorts by %s ascending and descending', (key, ascending, descending) => {
      expect(sorted(asc(key))).toEqual(ascending);
      expect(sorted(desc(key))).toEqual(descending);
    });
  });

  describe('stability', () => {
    // All medium and open, reported 10, 5 and 1 minutes ago: the feed reads newest first.
    const old = incident('old', { code: 'INC-000010', reportedAt: ago(10 * MIN) });
    const mid = incident('mid', { code: 'INC-000011', reportedAt: ago(5 * MIN) });
    const fresh = incident('fresh', { code: 'INC-000012', reportedAt: ago(MIN) });
    const equal = [old, fresh, mid];

    it.each(['severity', 'status', 'source', 'place'] as const)(
      'keeps the feed order for equal %s keys in both directions',
      (key) => {
        expect(sorted(asc(key), equal)).toEqual(['fresh', 'mid', 'old']);
        expect(sorted(desc(key), equal)).toEqual(['fresh', 'mid', 'old']);
      },
    );

    it('breaks a tie the feed leaves by the code, then by the id', () => {
      const same = { reportedAt: ago(MIN) };
      const rows = [
        incident('z', { ...same, code: 'INC-000100' }),
        incident('y', { ...same, code: 'INC-000099' }),
        incident('x2', { ...same, code: 'INC-000100' }),
      ];

      expect(sorted(desc('severity'), rows)).toEqual(['y', 'x2', 'z']);
      expect(sorted(asc('severity'), rows)).toEqual(['y', 'x2', 'z']);
    });

    it('gives the same order whatever order the rows come in', () => {
      for (const key of KEYS) {
        for (const sort of [asc(key), desc(key)]) {
          expect(sorted(sort, [...ROWS].reverse())).toEqual(sorted(sort));
        }
      }
    });

    it('changes nothing when a sorted result is sorted again', () => {
      for (const key of KEYS) {
        const once = sortIncidents(ROWS, desc(key), CONTEXT);
        expect(ids(sortIncidents(once, desc(key), CONTEXT))).toEqual(ids(once));
      }
    });
  });

  it('returns a new array and leaves its input as it was', () => {
    const rows = Object.freeze([...ROWS]);

    const result = sortIncidents(rows, asc('code'), CONTEXT);

    expect(result).not.toBe(rows);
    expect(ids(rows)).toEqual(['c', 'b', 'd', 'a']);
  });

  it("is the feed's order with no sort", () => {
    expect(sorted(null)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('sorts codes by their number, not as text', () => {
    const rows = [
      incident('k', { code: 'INC-1000' }),
      incident('j', { code: 'INC-999' }),
      incident('i', { code: 'INC-000100' }),
    ];

    expect(sorted(asc('code'), rows)).toEqual(['i', 'j', 'k']);
  });

  it('folds accents and case in a place name', () => {
    const zoneName = new Map([
      ['z-1', 'Đông'],
      ['z-2', 'cafe'],
      ['z-3', 'Bảo vệ'],
    ]);
    const rows = [
      incident('east', { zoneId: 'z-1' }),
      incident('cafe', { zoneId: 'z-2' }),
      incident('guard', { zoneId: 'z-3' }),
    ];

    expect(sorted(asc('place'), rows, { zoneName, now: NOW })).toEqual(['guard', 'cafe', 'east']);
  });

  it('orders by the time, not the text, of times in different zones', () => {
    // 08:00+07:00 is 01:00Z, an hour before 02:00Z; as text it would come after.
    const rows = [
      incident('zulu', { reportedAt: '2026-11-04T02:00:00.000Z' }),
      incident('plus7', { reportedAt: '2026-11-04T08:00:00.000+07:00' }),
    ];

    expect(sorted(asc('raised'), rows)).toEqual(['plus7', 'zulu']);
  });

  // A value the API sends before this console knows it, or one that cannot be read, never jumps to the top on a reversed
  // sort and never throws.
  describe('missing and unknown values, last in both directions', () => {
    // Critical and open, so the feed would put it first: last is the sort's doing.
    it.each([
      ['status', { status: unknown<IncidentStatus>('escalated') }],
      ['source', { source: unknown<IncidentSource>('sensor_v2') }],
      ['severity', { severity: unknown<IncidentSeverity>('extreme') }],
      ['place', { zoneId: 'z-gone' }],
      ['raised', { reportedAt: 'not a date' }],
      ['code', { code: 'INC-PENDING' }],
    ] as const)('puts an unreadable %s last', (key, overrides) => {
      const odd = incident('odd', { severity: 'critical', reportedAt: ago(10_000), ...overrides });
      const rows = [odd, ...ROWS];

      expect(sorted(asc(key), rows).at(-1)).toBe('odd');
      expect(sorted(desc(key), rows).at(-1)).toBe('odd');
    });

    it.each([
      ['acknowledged', { status: 'acknowledged', acknowledgedAt: ago(10_000) }],
      ['resolved', { status: 'resolved', acknowledgedAt: ago(10_000), resolvedAt: ago(5_000) }],
    ] as const)(
      'puts an %s incident, which has no countdown, after the open ones',
      (_, overrides) => {
        // Critical and the newest, so the feed would put it before both open ones.
        const odd = incident('odd', {
          severity: 'critical',
          reportedAt: ago(20_000),
          ...overrides,
        });
        const rows = [odd, A, D];

        expect(sorted(asc('attention'), rows)).toEqual(['d', 'a', 'odd']);
        expect(sorted(desc('attention'), rows)).toEqual(['a', 'd', 'odd']);
      },
    );

    it('puts a simulator incident after a telemetry one, and an unknown source after both', () => {
      const rows = [
        incident('new', { source: unknown<IncidentSource>('sensor_v2') }),
        incident('sim', { source: 'simulator' }),
        incident('rule', { source: 'telemetry' }),
        incident('person', { source: 'operator' }),
      ];

      expect(sorted(asc('source'), rows)).toEqual(['person', 'rule', 'sim', 'new']);
    });

    it("gives the feed's order for a sort key no column has", () => {
      const stored = { key: 'priority', direction: 'ascending' } as unknown as TableSort;

      expect(sorted(stored)).toEqual(['a', 'd', 'b', 'c']);
    });
  });

  // 500 is the most `GET /incidents` returns. A guard against an accidental quadratic step (a fold or a parse per
  // comparison, a scan per row), not a speed test: the bound is loose on purpose.
  it('sorts 500 incidents by every column in both directions in a few ms', () => {
    const severities: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
    const statuses: IncidentStatus[] = ['open', 'acknowledged', 'resolved'];
    const sources: IncidentSource[] = ['operator', 'telemetry', 'simulator'];
    const zoneIds = [...ZONES.keys()];
    const many = Array.from({ length: 500 }, (_, index) =>
      incident(`n${index}`, {
        code: `INC-${String(index).padStart(6, '0')}`,
        severity: severities[index % severities.length]!,
        status: statuses[index % statuses.length]!,
        source: sources[index % sources.length]!,
        zoneId: zoneIds[index % zoneIds.length]!,
        title: `Đèn ${(index * 37) % 500}`,
        reportedAt: ago(index * 7_000),
      }),
    );
    const sorts = KEYS.flatMap((key) => [asc(key), desc(key)]);
    // Once before timing, so the first run's compilation is not what is measured.
    sortIncidents(many, asc('incident'), CONTEXT);

    const started = performance.now();
    const results = sorts.map((sort) => sortIncidents(many, sort, CONTEXT));
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(50);
    const everyId = new Set(ids(many));
    for (const result of results) {
      expect(result).toHaveLength(500);
      expect(new Set(ids(result))).toEqual(everyId);
    }
    // Codes and times are all different, so one direction is the other reversed.
    const at = (sort: TableSort) => results[sorts.indexOf(sort)]!;
    for (const key of ['code', 'raised'] as const) {
      const up = sorts.find((sort) => sort.key === key && sort.direction === 'ascending')!;
      const down = sorts.find((sort) => sort.key === key && sort.direction === 'descending')!;
      expect(ids(at(up))).toEqual(ids(at(down)).reverse());
    }
  });
});

describe('nextSort and ariaSortOf', () => {
  it.each(TABLE_COLUMNS.map((column) => [column.key, column.defaultDirection] as const))(
    'cycles %s from its default (%s) to the opposite, then to no sort',
    (key, first) => {
      const second = first === 'ascending' ? 'descending' : 'ascending';

      const one = nextSort(null, key);
      const two = nextSort(one, key);
      const three = nextSort(two, key);

      expect(one).toEqual({ key, direction: first });
      expect(two).toEqual({ key, direction: second });
      expect(three).toBeNull();
      expect(nextSort(three, key)).toEqual(one);
    },
  );

  it('starts another column at its own default', () => {
    expect(nextSort(asc('incident'), 'raised')).toEqual(desc('raised'));
    expect(nextSort(desc('severity'), 'place')).toEqual(asc('place'));
  });

  it('agrees with nextSort on every header at every step', () => {
    for (const pressed of KEYS) {
      let sort: TableSort | null = null;
      for (let step = 0; step < 3; step += 1) {
        sort = nextSort(sort, pressed);
        for (const header of KEYS) {
          const expected = sort !== null && header === pressed ? sort.direction : 'none';
          expect(ariaSortOf(header, sort)).toBe(expected);
        }
      }
    }
  });

  it('is none on every header with no sort', () => {
    expect(KEYS.map((key) => ariaSortOf(key, null))).toEqual(KEYS.map(() => 'none'));
  });
});
