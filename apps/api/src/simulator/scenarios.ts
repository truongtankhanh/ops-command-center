import type { IncidentSeverity, IncidentType, ZoneKind } from '@occ/contracts';

export interface Scenario {
  type: IncidentType;
  severity: IncidentSeverity;
  /** Variants, so a busy feed does not read as the same line repeated. */
  titles: string[];
  description: string;
  /** Zone kinds where this scenario makes sense. */
  zoneKinds: ZoneKind[];
  /** Relative frequency. */
  weight: number;
}

export const SCENARIOS: Scenario[] = [
  {
    type: 'crowding',
    severity: 'low',
    titles: [
      'Crowd density above threshold',
      'Crowd forming at entrance',
      'Unusual gathering detected',
    ],
    description: 'Video analytics counted more people than the zone comfort limit.',
    zoneKinds: ['gate', 'outdoor', 'building'],
    weight: 5,
  },
  {
    type: 'equipment_fault',
    severity: 'medium',
    titles: [
      'Access control reader not responding',
      'Barrier arm stuck open',
      'Door controller offline',
    ],
    description: 'Reader heartbeat missed three consecutive intervals.',
    zoneKinds: ['building', 'gate', 'parking'],
    weight: 4,
  },
  {
    type: 'suspicious_object',
    severity: 'medium',
    titles: ['Unattended bag detected', 'Object left near entrance', 'Unclaimed parcel reported'],
    description: 'Object left stationary for more than five minutes.',
    zoneKinds: ['outdoor', 'building', 'gate'],
    weight: 3,
  },
  {
    type: 'intrusion',
    severity: 'high',
    titles: [
      'Perimeter line crossed after hours',
      'Motion in restricted area',
      'Fence sensor triggered',
    ],
    description: 'Virtual tripwire triggered outside permitted hours.',
    zoneKinds: ['parking', 'outdoor', 'building'],
    weight: 2,
  },
  {
    type: 'medical',
    severity: 'high',
    titles: ['Person down reported', 'Help point call: injury', 'First aid requested'],
    description: 'Help-point call: a person needs medical assistance.',
    zoneKinds: ['outdoor', 'building'],
    weight: 1,
  },
  {
    type: 'fire_alarm',
    severity: 'critical',
    titles: ['Fire alarm activated', 'Smoke detector triggered', 'Heat sensor above threshold'],
    description: 'Manual call point activated. Evacuation protocol may apply.',
    zoneKinds: ['building'],
    weight: 1,
  },
];

/** Weighted random pick. `random` is injectable so behaviour is deterministic in tests. */
export function pickWeighted<T extends { weight: number }>(items: T[], random: () => number): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items[items.length - 1]!;
}

export function scenariosFor(kind: ZoneKind): Scenario[] {
  return SCENARIOS.filter((scenario) => scenario.zoneKinds.includes(kind));
}
