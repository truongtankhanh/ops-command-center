import type { Incident } from '@occ/contracts';
import {
  compareIncidents,
  countActiveBySeverity,
  formatAge,
  matchesFilter,
  mergeIncidentLists,
  newerIncident,
  upsertIncident,
} from './incidents';

const incident = (overrides: Partial<Incident>): Incident => ({
  id: 'id',
  code: 'INC-000001',
  type: 'intrusion',
  severity: 'medium',
  status: 'open',
  title: 'Test',
  description: null,
  zoneId: 'z1',
  position: [108.44, 11.95],
  source: 'operator',
  reportedAt: '2026-10-01T08:00:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

describe('compareIncidents', () => {
  it('puts unresolved before resolved, then severity, then newest', () => {
    const list = [
      incident({ id: 'resolved-critical', severity: 'critical', status: 'resolved' }),
      incident({ id: 'low', severity: 'low' }),
      incident({ id: 'high-old', severity: 'high', reportedAt: '2026-10-01T07:00:00.000Z' }),
      incident({ id: 'high-new', severity: 'high', reportedAt: '2026-10-01T09:00:00.000Z' }),
    ];

    expect([...list].sort(compareIncidents).map((i) => i.id)).toEqual([
      'high-new',
      'high-old',
      'low',
      'resolved-critical',
    ]);
  });
});

describe('upsertIncident', () => {
  it('replaces an existing incident and re-sorts', () => {
    const list = [incident({ id: 'a', severity: 'high' }), incident({ id: 'b', severity: 'low' })];
    const next = upsertIncident(
      list,
      incident({ id: 'a', severity: 'high', status: 'resolved', version: 2 }),
    );

    expect(next.map((i) => i.id)).toEqual(['b', 'a']);
    expect(list[0]!.status).toBe('open'); // input untouched
  });

  it('inserts into an empty cache', () => {
    expect(upsertIncident(undefined, incident({ id: 'a' }))).toHaveLength(1);
  });

  it('ignores an older copy and returns the same list', () => {
    const list = [incident({ id: 'a', status: 'resolved', version: 3 })];
    const next = upsertIncident(list, incident({ id: 'a', status: 'acknowledged', version: 2 }));

    expect(next).toBe(list);
    expect(next[0]!.status).toBe('resolved');
  });

  it('ignores a copy with the same version', () => {
    const list = [incident({ id: 'a', status: 'resolved', version: 2 })];

    expect(upsertIncident(list, incident({ id: 'a', status: 'open', version: 2 }))).toBe(list);
  });
});

describe('newerIncident', () => {
  it('takes the incoming copy when nothing is cached', () => {
    const incoming = incident({ version: 1 });
    expect(newerIncident(undefined, incoming)).toBe(incoming);
  });

  it('keeps the cached copy when it is newer', () => {
    const cached = incident({ version: 3 });
    expect(newerIncident(cached, incident({ version: 2 }))).toBe(cached);
  });

  it('keeps the cached copy on a tie', () => {
    const cached = incident({ version: 2 });
    expect(newerIncident(cached, incident({ version: 2 }))).toBe(cached);
  });

  it('takes the incoming copy when it is newer', () => {
    const incoming = incident({ version: 3 });
    expect(newerIncident(incident({ version: 2 }), incoming)).toBe(incoming);
  });
});

describe('mergeIncidentLists', () => {
  it('keeps a cached copy that is newer than the snapshot', () => {
    const cached = incident({ id: 'a', status: 'resolved', version: 3 });
    const merged = mergeIncidentLists(
      [cached],
      [incident({ id: 'a', status: 'acknowledged', version: 2 })],
    );

    expect(merged).toEqual([cached]);
    expect(merged[0]).toBe(cached);
  });

  it('takes a snapshot copy that is newer than the cache', () => {
    const fetched = incident({ id: 'a', status: 'acknowledged', version: 2 });
    const merged = mergeIncidentLists([incident({ id: 'a', version: 1 })], [fetched]);

    expect(merged[0]).toBe(fetched);
  });

  it('keeps incidents missing from the snapshot', () => {
    const merged = mergeIncidentLists(
      [incident({ id: 'a' }), incident({ id: 'b' })],
      [incident({ id: 'a' })],
    );

    expect(merged.map((i) => i.id)).toContain('b');
  });

  it('adds incidents only in the snapshot', () => {
    const merged = mergeIncidentLists(
      [incident({ id: 'a' })],
      [incident({ id: 'a' }), incident({ id: 'c' })],
    );

    expect(merged.map((i) => i.id).sort()).toEqual(['a', 'c']);
  });

  it('orders the result like the feed', () => {
    const merged = mergeIncidentLists(
      [incident({ id: 'resolved-critical', severity: 'critical', status: 'resolved' })],
      [incident({ id: 'low', severity: 'low' }), incident({ id: 'high', severity: 'high' })],
    );

    expect(merged.map((i) => i.id)).toEqual(['high', 'low', 'resolved-critical']);
  });

  it('returns the snapshot, sorted, when nothing is cached', () => {
    const merged = mergeIncidentLists(undefined, [
      incident({ id: 'low', severity: 'low' }),
      incident({ id: 'high', severity: 'high' }),
    ]);

    expect(merged.map((i) => i.id)).toEqual(['high', 'low']);
  });

  it('does not mutate either input', () => {
    const cached = [incident({ id: 'b', severity: 'low' }), incident({ id: 'a', version: 2 })];
    const fetched = [incident({ id: 'c', severity: 'high' }), incident({ id: 'a', version: 1 })];
    const cachedBefore = [...cached];
    const fetchedBefore = [...fetched];

    mergeIncidentLists(cached, fetched);

    expect(cached).toEqual(cachedBefore);
    expect(fetched).toEqual(fetchedBefore);
  });
});

describe('matchesFilter', () => {
  it('treats open and acknowledged as active', () => {
    expect(matchesFilter(incident({ status: 'acknowledged' }), 'active')).toBe(true);
    expect(matchesFilter(incident({ status: 'resolved' }), 'active')).toBe(false);
    expect(matchesFilter(incident({ status: 'resolved' }), 'resolved')).toBe(true);
  });
});

describe('countActiveBySeverity', () => {
  it('ignores resolved incidents', () => {
    const counts = countActiveBySeverity([
      incident({ severity: 'critical' }),
      incident({ severity: 'critical', status: 'resolved' }),
      incident({ severity: 'low', status: 'acknowledged' }),
    ]);
    expect(counts).toEqual({ critical: 1, high: 0, medium: 0, low: 1 });
  });
});

describe('formatAge', () => {
  const t0 = Date.parse('2026-10-01T08:00:00.000Z');
  it.each([
    [5_000, 'now'],
    [42_000, '42s'],
    [12 * 60_000, '12m'],
    [3 * 3_600_000, '3h'],
    [72 * 3_600_000, '3d'],
  ])('formats %i ms as %s', (elapsed, expected) => {
    expect(formatAge('2026-10-01T08:00:00.000Z', t0 + elapsed)).toBe(expected);
  });
});
