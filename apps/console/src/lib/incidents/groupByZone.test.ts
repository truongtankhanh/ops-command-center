import type { Incident, IncidentSeverity, IncidentStatus } from '@occ/contracts';
import {
  groupByZone,
  groupedEntries,
  groupEntryId,
  groupIdOf,
  OTHER_ZONE_ID,
  OTHER_ZONE_NAME,
} from './groupByZone';

const zones = [
  { id: 'z-lib', name: 'Library' },
  { id: 'z-gym', name: 'Gym' },
  { id: 'z-lab', name: 'Science Lab' },
];

let sequence = 0;
const incident = (overrides: Partial<Incident> = {}): Incident => {
  sequence += 1;
  return {
    id: `i${sequence}`,
    code: `INC-${sequence}`,
    type: 'fire_alarm',
    severity: 'medium',
    status: 'open',
    title: `Incident ${sequence}`,
    description: null,
    zoneId: 'z-lib',
    position: [108.44, 11.95],
    source: 'operator',
    reportedAt: '2026-10-01T12:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  };
};

/** `count` incidents in one zone, with the given severity and status. */
const inZone = (
  zoneId: string,
  count: number,
  severity: IncidentSeverity = 'medium',
  status: IncidentStatus = 'open',
) => Array.from({ length: count }, () => incident({ zoneId, severity, status }));

beforeEach(() => {
  sequence = 0;
});

describe('groupByZone', () => {
  it('is empty for no incidents', () => {
    expect(groupByZone([], zones)).toEqual([]);
  });

  it('makes one group per zone that has an incident, and none for a zone without one', () => {
    const groups = groupByZone([...inZone('z-lib', 2), ...inZone('z-gym', 1)], zones);

    expect(groups.map((group) => group.zoneId).sort()).toEqual(['z-gym', 'z-lib']);
  });

  it('counts every incident of the zone and the ones still open', () => {
    const [group] = groupByZone(
      [
        ...inZone('z-lib', 2, 'high', 'open'),
        ...inZone('z-lib', 1, 'high', 'acknowledged'),
        ...inZone('z-lib', 1, 'high', 'resolved'),
      ],
      zones,
    );

    expect(group).toMatchObject({ zoneId: 'z-lib', name: 'Library', count: 4, open: 2 });
  });

  it('takes the worst severity of the group', () => {
    const [group] = groupByZone(
      [
        incident({ severity: 'low' }),
        incident({ severity: 'critical' }),
        incident({ severity: 'medium' }),
      ],
      zones,
    );

    expect(group?.worst).toBe('critical');
  });

  it('takes the latest reported time, and skips one that does not parse', () => {
    const [group] = groupByZone(
      [
        incident({ reportedAt: '2026-10-01T12:00:00.000Z' }),
        incident({ reportedAt: '2026-10-01T12:30:00.000Z' }),
        incident({ reportedAt: 'not a date' }),
      ],
      zones,
    );

    expect(group?.newestAt).toBe(Date.parse('2026-10-01T12:30:00.000Z'));
  });

  it('has no newest time when none parses', () => {
    const [group] = groupByZone([incident({ reportedAt: 'nope' })], zones);

    expect(group?.newestAt).toBeNull();
  });

  it('keeps each group’s incidents in the order they came in', () => {
    const list = [
      incident({ zoneId: 'z-lib' }),
      incident({ zoneId: 'z-gym' }),
      incident({ zoneId: 'z-lib' }),
    ];

    const groups = groupByZone(list, zones);

    expect(groups.find((group) => group.zoneId === 'z-lib')?.incidents).toEqual([list[0], list[2]]);
  });

  describe('the order', () => {
    it('puts the worst severity first, whatever the counts', () => {
      const groups = groupByZone(
        [...inZone('z-lib', 5, 'high'), ...inZone('z-gym', 1, 'critical')],
        zones,
      );

      expect(groups.map((group) => group.name)).toEqual(['Gym', 'Library']);
    });

    it('then the larger count', () => {
      const groups = groupByZone(
        [...inZone('z-lib', 1, 'high'), ...inZone('z-gym', 3, 'high')],
        zones,
      );

      expect(groups.map((group) => group.name)).toEqual(['Gym', 'Library']);
    });

    it('then the name, by plain code-unit order', () => {
      const groups = groupByZone(
        [
          ...inZone('z-lib', 2, 'high'),
          ...inZone('z-lab', 2, 'high'),
          ...inZone('z-gym', 2, 'high'),
        ],
        zones,
      );

      expect(groups.map((group) => group.name)).toEqual(['Gym', 'Library', 'Science Lab']);
    });

    it('then the zone id, for two zones with one name', () => {
      const twins = [
        { id: 'b', name: 'Annex' },
        { id: 'a', name: 'Annex' },
      ];

      const groups = groupByZone([...inZone('b', 1, 'low'), ...inZone('a', 1, 'low')], twins);

      expect(groups.map((group) => group.zoneId)).toEqual(['a', 'b']);
    });

    it('is the same whatever order the incidents arrive in', () => {
      const list = [
        ...inZone('z-lib', 2, 'high'),
        ...inZone('z-gym', 2, 'high'),
        ...inZone('z-lab', 1, 'critical'),
      ];

      const forward = groupByZone(list, zones).map((group) => group.zoneId);
      const backward = groupByZone([...list].reverse(), zones).map((group) => group.zoneId);

      expect(backward).toEqual(forward);
    });
  });

  describe('a zone the console does not know', () => {
    it('joins one group called "Other zone"', () => {
      const groups = groupByZone(
        [incident({ zoneId: 'gone-1' }), incident({ zoneId: 'gone-2' }), incident()],
        zones,
      );

      const other = groups.find((group) => group.zoneId === OTHER_ZONE_ID);
      expect(other).toMatchObject({ name: OTHER_ZONE_NAME, count: 2 });
      expect(OTHER_ZONE_NAME).toBe('Other zone');
      expect(groups).toHaveLength(2);
    });

    it('is ordered by the same rule as the others', () => {
      const groups = groupByZone(
        [...inZone('z-lib', 3, 'medium'), incident({ zoneId: 'gone', severity: 'critical' })],
        zones,
      );

      expect(groups.map((group) => group.name)).toEqual([OTHER_ZONE_NAME, 'Library']);
    });

    it('holds every incident when no zone is known', () => {
      const groups = groupByZone(inZone('z-lib', 4), []);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({ zoneId: OTHER_ZONE_ID, count: 4 });
    });
  });

  it('does not change what it is given', () => {
    const list = Object.freeze([...inZone('z-lib', 2), ...inZone('z-gym', 1)]);
    const copy = list.map((entry) => ({ ...entry }));

    groupByZone(list, Object.freeze(zones));

    expect(list).toEqual(copy);
  });
});

describe('groupedEntries', () => {
  const groups = () =>
    groupByZone([...inZone('z-gym', 2, 'critical'), ...inZone('z-lib', 1, 'high')], zones);

  it('is one row per group while none is expanded', () => {
    const entries = groupedEntries(groups(), new Set());

    expect(entries.map((entry) => entry.kind)).toEqual(['group', 'group']);
    expect(entries.map((entry) => entry.id)).toEqual([
      groupEntryId('z-gym'),
      groupEntryId('z-lib'),
    ]);
  });

  it('puts an expanded group’s incidents right after its row, in their order', () => {
    const all = groups();

    const entries = groupedEntries(all, new Set(['z-gym']));

    expect(entries.map((entry) => entry.kind)).toEqual(['group', 'incident', 'incident', 'group']);
    const rows = entries.filter((entry) => entry.kind === 'incident');
    expect(rows.map((entry) => entry.id)).toEqual(all[0]?.incidents.map((i) => i.id));
    expect(rows.every((entry) => entry.groupId === groupEntryId('z-gym'))).toBe(true);
  });

  it('expands several groups, each under its own row', () => {
    const entries = groupedEntries(groups(), new Set(['z-gym', 'z-lib']));

    expect(entries.map((entry) => entry.kind)).toEqual([
      'group',
      'incident',
      'incident',
      'group',
      'incident',
    ]);
  });

  it('ignores an expanded zone that has no group any more', () => {
    const entries = groupedEntries(groups(), new Set(['z-lab']));

    expect(entries).toHaveLength(2);
  });

  it('is empty for no groups', () => {
    expect(groupedEntries([], new Set(['z-gym']))).toEqual([]);
  });

  it('gives every row an id of its own, group and incident alike', () => {
    const entries = groupedEntries(groups(), new Set(['z-gym', 'z-lib']));

    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });
});

describe('groupEntryId and groupIdOf', () => {
  it('names a group’s row after its zone', () => {
    expect(groupEntryId('z-lib')).toBe('zone:z-lib');
  });

  it('finds the row of the group that holds an incident, collapsed or not', () => {
    const list = [incident({ zoneId: 'z-lib' }), incident({ zoneId: 'z-gym' })];
    const groups = groupByZone(list, zones);

    expect(groupIdOf(groups, list[1]!.id)).toBe(groupEntryId('z-gym'));
  });

  it('is null for an incident no group holds', () => {
    expect(groupIdOf(groupByZone([incident()], zones), 'missing')).toBeNull();
    expect(groupIdOf([], 'missing')).toBeNull();
  });
});
