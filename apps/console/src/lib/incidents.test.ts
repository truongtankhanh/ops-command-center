import { type Incident, INCIDENT_EVENT_KINDS, INCIDENT_SEVERITIES } from '@occ/contracts';
import {
  acknowledgeDuration,
  ATTENTION_THRESHOLD_MS,
  compareIncidents,
  countActiveBySeverity,
  countByFilter,
  eventLabel,
  feedEmptyMessage,
  formatAge,
  formatAgo,
  formatClock,
  formatDuration,
  isPastAttention,
  lifecycleSteps,
  matchesFilter,
  matchesQuery,
  matchesSeverity,
  mergeIncidentLists,
  newerIncident,
  openDuration,
  searchTerms,
  severityLabel,
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

describe('matchesSeverity', () => {
  it('matches every incident without a severity filter', () => {
    for (const severity of INCIDENT_SEVERITIES) {
      expect(matchesSeverity(incident({ severity }), null)).toBe(true);
    }
  });

  it.each(INCIDENT_SEVERITIES)('matches only %s incidents', (selected) => {
    for (const severity of INCIDENT_SEVERITIES) {
      expect(matchesSeverity(incident({ severity }), selected)).toBe(severity === selected);
    }
  });
});

describe('feedEmptyMessage', () => {
  it("keeps the feed's texts without a severity", () => {
    expect(feedEmptyMessage('active', null)).toBe(
      'No active incidents. New reports appear here as they come in.',
    );
    expect(feedEmptyMessage('resolved', null)).toBe('Nothing resolved yet this shift.');
    expect(feedEmptyMessage('all', null)).toBe('No incidents recorded yet.');
  });

  it.each([
    ['active', 'high', 'No active high incidents.'],
    ['resolved', 'critical', 'No resolved critical incidents.'],
    ['all', 'low', 'No low incidents recorded yet.'],
  ] as const)('names the severity on the %s tab', (filter, severity, expected) => {
    expect(feedEmptyMessage(filter, severity)).toBe(expected);
  });

  it.each([
    ['active', null, 'xyz', 'No active incidents match "xyz".'],
    ['resolved', 'high', ' xyz ', 'No resolved high incidents match "xyz".'],
    ['all', null, 'xyz', 'No incidents match "xyz".'],
  ] as const)('names the search on the %s tab', (filter, severity, query, expected) => {
    expect(feedEmptyMessage(filter, severity, query)).toBe(expected);
  });

  it('ignores a blank search', () => {
    expect(feedEmptyMessage('active', null, '   ')).toBe(feedEmptyMessage('active', null));
  });
});

describe('searchTerms', () => {
  it.each([
    ['   ', []],
    ['Door  forced\tOPEN', ['door', 'forced', 'open']],
    ['Cháy', ['chay']],
    ['Đường đi', ['duong', 'di']],
  ] as const)('folds %j into %j', (query, expected) => {
    expect(searchTerms(query)).toEqual(expected);
  });
});

describe('matchesQuery', () => {
  it('matches every incident without terms', () => {
    expect(matchesQuery(incident({}), [])).toBe(true);
  });

  it.each([
    ['code', 'inc-0000', {}, undefined],
    ['title', 'forced', { title: 'Door forced open' }, undefined],
    ['zone name', 'library', {}, 'Library'],
  ] as const)('finds a term in the %s', (_field, term, overrides, zone) => {
    expect(matchesQuery(incident(overrides), [term], zone)).toBe(true);
  });

  it('needs every term', () => {
    const door = incident({ title: 'Door forced open' });
    expect(matchesQuery(door, ['door', 'open'])).toBe(true);
    expect(matchesQuery(door, ['door', 'gate'])).toBe(false);
  });

  it('never matches a term across two fields', () => {
    expect(matchesQuery(incident({ title: 'Main' }), ['maingate'], 'Gate')).toBe(false);
  });

  it('ignores accents and case end to end', () => {
    expect(matchesQuery(incident({ title: 'Chay nho' }), searchTerms('CHÁY'))).toBe(true);
  });
});

describe('countByFilter', () => {
  const list = [
    incident({ id: 'o', status: 'open' }),
    incident({ id: 'a', status: 'acknowledged' }),
    incident({ id: 'r', status: 'resolved' }),
  ];

  it('counts what each tab would list', () => {
    expect(countByFilter(list, () => true)).toEqual({ active: 2, resolved: 1, all: 3 });
  });

  it('counts only the incidents that match', () => {
    expect(countByFilter(list, (i) => i.status !== 'acknowledged')).toEqual({
      active: 1,
      resolved: 1,
      all: 2,
    });
  });
});

describe('isPastAttention', () => {
  const t0 = Date.parse('2026-10-01T08:00:00.000Z');

  it('uses the provisional thresholds', () => {
    expect(ATTENTION_THRESHOLD_MS).toEqual({
      critical: 120_000,
      high: 300_000,
      medium: 900_000,
      low: 1_800_000,
    });
  });

  it.each(INCIDENT_SEVERITIES)('flags an open %s incident from its threshold on', (severity) => {
    const threshold = ATTENTION_THRESHOLD_MS[severity];
    expect(isPastAttention(incident({ severity }), t0 + threshold - 1)).toBe(false);
    expect(isPastAttention(incident({ severity }), t0 + threshold)).toBe(true);
  });

  it('never flags an acknowledged or resolved incident', () => {
    const dayLater = t0 + 24 * 3_600_000;
    for (const status of ['acknowledged', 'resolved'] as const) {
      expect(isPastAttention(incident({ severity: 'critical', status }), dayLater)).toBe(false);
    }
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

describe('severityLabel', () => {
  it('names every severity in title case, in contract order', () => {
    expect(INCIDENT_SEVERITIES.map(severityLabel)).toEqual(['Low', 'Medium', 'High', 'Critical']);
  });
});

describe('formatAgo', () => {
  const t0 = Date.parse('2026-10-01T08:00:00.000Z');
  it.each([
    [5_000, 'just now'],
    [14 * 60_000, '14m ago'],
  ])('formats %i ms as %s', (elapsed, expected) => {
    expect(formatAgo('2026-10-01T08:00:00.000Z', t0 + elapsed)).toBe(expected);
  });
});

describe('formatDuration', () => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  it.each([
    [-1, '0s'],
    [45_000, '45s'],
    [14 * MINUTE, '14m'],
    [HOUR, '1h'],
    [95 * MINUTE, '1h 35m'],
    [47 * HOUR + 59 * MINUTE, '47h 59m'],
    [48 * HOUR, '2d'],
    [51 * HOUR, '2d 3h'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

// Built from local dates and the same locale options, so the cases hold in any time zone and locale.
describe('formatClock', () => {
  const at = new Date(2026, 9, 6, 14, 7);
  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  it('shows only the clock time on the same local day', () => {
    expect(formatClock(at.toISOString(), new Date(2026, 9, 6, 18, 0).getTime())).toBe(clock);
  });

  it('adds the date on another day', () => {
    const date = at.toLocaleDateString([], { day: 'numeric', month: 'short' });
    expect(formatClock(at.toISOString(), new Date(2026, 9, 7, 9, 0).getTime())).toBe(
      `${date} ${clock}`,
    );
  });
});

describe('lifecycleSteps', () => {
  const reportedAt = '2026-10-01T08:00:00.000Z';
  const acknowledgedAt = '2026-10-01T08:05:00.000Z';
  const resolvedAt = '2026-10-01T09:35:00.000Z';
  const states = (subject: Incident) => lifecycleSteps(subject).map((step) => step.state);
  const times = (subject: Incident) => lifecycleSteps(subject).map((step) => step.at);

  it('always lists the three steps in order', () => {
    expect(lifecycleSteps(incident({})).map((step) => step.kind)).toEqual([
      'reported',
      'acknowledged',
      'resolved',
    ]);
  });

  it('waits for acknowledgement while open', () => {
    const open = incident({ reportedAt });
    expect(states(open)).toEqual(['done', 'current', 'future']);
    expect(times(open)).toEqual([reportedAt, null, null]);
  });

  it('waits for resolution once acknowledged', () => {
    const acknowledged = incident({ status: 'acknowledged', reportedAt, acknowledgedAt });
    expect(states(acknowledged)).toEqual(['done', 'done', 'current']);
    expect(times(acknowledged)).toEqual([reportedAt, acknowledgedAt, null]);
  });

  it('has every step done once resolved after acknowledging', () => {
    const resolved = incident({ status: 'resolved', reportedAt, acknowledgedAt, resolvedAt });
    expect(states(resolved)).toEqual(['done', 'done', 'done']);
    expect(times(resolved)).toEqual([reportedAt, acknowledgedAt, resolvedAt]);
  });

  it('skips acknowledging when resolved straight from open', () => {
    const resolved = incident({ status: 'resolved', reportedAt, resolvedAt });
    expect(states(resolved)).toEqual(['done', 'skipped', 'done']);
    expect(times(resolved)).toEqual([reportedAt, null, resolvedAt]);
  });
});

describe('openDuration', () => {
  const t0 = Date.parse('2026-10-01T08:00:00.000Z');

  it('runs until now while not resolved', () => {
    expect(openDuration(incident({}), t0 + 14 * 60_000)).toEqual({ ms: 14 * 60_000, final: false });
  });

  it('stops at the resolution, whatever the time now', () => {
    const resolved = incident({ status: 'resolved', resolvedAt: '2026-10-01T09:35:00.000Z' });
    expect(openDuration(resolved, t0 + 48 * 3_600_000)).toEqual({ ms: 95 * 60_000, final: true });
  });
});

describe('acknowledgeDuration', () => {
  it('measures from report to acknowledgement', () => {
    expect(
      acknowledgeDuration(
        incident({ status: 'acknowledged', acknowledgedAt: '2026-10-01T08:05:00.000Z' }),
      ),
    ).toBe(5 * 60_000);
  });

  it('is pending while nobody has acknowledged', () => {
    expect(acknowledgeDuration(incident({}))).toBe('pending');
  });

  it('is skipped when resolved without acknowledging', () => {
    expect(
      acknowledgeDuration(incident({ status: 'resolved', resolvedAt: '2026-10-01T09:35:00.000Z' })),
    ).toBe('skipped');
  });
});

describe('eventLabel', () => {
  it('names every event kind, in contract order', () => {
    expect(INCIDENT_EVENT_KINDS.map(eventLabel)).toEqual(['Reported', 'Acknowledged', 'Resolved']);
  });
});
