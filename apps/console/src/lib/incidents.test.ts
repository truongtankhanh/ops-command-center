import type { Incident } from '@occ/contracts';
import {
  compareIncidents,
  countActiveBySeverity,
  formatAge,
  matchesFilter,
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
    const next = upsertIncident(list, incident({ id: 'a', severity: 'high', status: 'resolved' }));

    expect(next.map((i) => i.id)).toEqual(['b', 'a']);
    expect(list[0]!.status).toBe('open'); // input untouched
  });

  it('inserts into an empty cache', () => {
    expect(upsertIncident(undefined, incident({ id: 'a' }))).toHaveLength(1);
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
