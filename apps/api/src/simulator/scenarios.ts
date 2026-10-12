import {
  INCIDENT_TYPE_DEFAULT_SEVERITY,
  type IncidentSeverity,
  type IncidentType,
  type ZoneKind,
} from '@occ/contracts';

export interface Scenario {
  type: IncidentType;
  /** The type's default (`INCIDENT_TYPE_DEFAULT_SEVERITY`, ADR-0021), never a second value. */
  severity: IncidentSeverity;
  /** Variants, so a busy feed does not read as the same line repeated. */
  titles: string[];
  description: string;
  /** Zone kinds where this scenario makes sense. */
  zoneKinds: ZoneKind[];
  /** Relative frequency. */
  weight: number;
}

type ScenarioDefinition = Omit<Scenario, 'severity'>;

/**
 * One scenario per incident type. The six V1 types come first, in their order: the e2e suite
 * drives `tick(() => 0)`, which draws the first scenario of the first zone's kind. The rest follow
 * ADR-0021's table, category by category.
 *
 * `zoneKinds` follow the brief's "typical incidents" per zone, which is by kind: a zone's `use`
 * is not looked at, so a lab incident can land in a dormitory. Weights favour the common types
 * and are a proposal (`unverified`); `fire` and `gas_leak` are the demo's critical incidents.
 */
const DEFINITIONS: ScenarioDefinition[] = [
  {
    type: 'crowding',
    titles: [
      'Crowd density above threshold',
      'Crowd forming at entrance',
      'Unusual gathering detected',
    ],
    description: 'Video analytics counted more people than the zone comfort limit.',
    zoneKinds: ['gate', 'outdoor', 'building', 'sports'],
    weight: 5,
  },
  {
    type: 'equipment_fault',
    titles: [
      'Access control reader not responding',
      'Barrier arm stuck open',
      'Door controller offline',
    ],
    description: 'Reader heartbeat missed three consecutive intervals.',
    zoneKinds: ['building', 'gate', 'parking', 'utility'],
    weight: 4,
  },
  {
    type: 'suspicious_object',
    titles: ['Unattended bag detected', 'Object left near entrance', 'Unclaimed parcel reported'],
    description: 'Object left stationary for more than five minutes.',
    zoneKinds: ['outdoor', 'building', 'gate'],
    weight: 3,
  },
  {
    type: 'intrusion',
    titles: [
      'Perimeter line crossed after hours',
      'Motion in restricted area',
      'Fence sensor triggered',
    ],
    description: 'Virtual tripwire triggered outside permitted hours.',
    zoneKinds: ['parking', 'outdoor', 'building', 'utility', 'gate'],
    weight: 2,
  },
  {
    type: 'medical',
    titles: ['Person down reported', 'Help point call: injury', 'First aid requested'],
    description: 'Help-point call: a person needs medical assistance.',
    zoneKinds: ['outdoor', 'building', 'sports', 'water'],
    weight: 2,
  },
  {
    // `high` since V2-04.4 (the contract default); it was `critical` here before, which made the
    // simulated fire alarm the only source of critical incidents in the demo.
    type: 'fire_alarm',
    titles: ['Fire alarm activated', 'Smoke detector triggered', 'Heat sensor above threshold'],
    description: 'Manual call point activated. Evacuation protocol may apply.',
    zoneKinds: ['building'],
    weight: 2,
  },
  {
    type: 'theft',
    titles: [
      'Bicycle theft reported',
      'Laptop taken from an unattended desk',
      'Break-in at a storage room',
    ],
    description: 'Reported by the owner; no suspect identified yet.',
    zoneKinds: ['building', 'parking'],
    weight: 3,
  },
  {
    type: 'vandalism',
    titles: ['Graffiti found on a wall', 'Damaged signage reported', 'Window broken overnight'],
    description: 'Property damage found during a patrol round.',
    zoneKinds: ['parking', 'building', 'outdoor'],
    weight: 2,
  },
  {
    type: 'suspicious_person',
    titles: [
      'Unknown person loitering near an entrance',
      'Person without a badge in a restricted area',
      'Individual photographing the perimeter',
    ],
    description: 'Spotted on camera; does not match any scheduled visitor.',
    zoneKinds: ['gate', 'outdoor', 'parking', 'building'],
    weight: 2,
  },
  {
    type: 'assault',
    titles: [
      'Altercation between two people',
      'Physical fight reported',
      'Staff member threatened',
    ],
    description: 'Reported by a witness; security response requested.',
    zoneKinds: ['outdoor', 'parking', 'building'],
    weight: 1,
  },
  {
    type: 'fire',
    titles: ['Fire reported — smoke visible', 'Open flame reported', 'Fire in a waste container'],
    description: 'Visible fire reported by staff. Emergency services may be required.',
    zoneKinds: ['building', 'utility'],
    weight: 1,
  },
  {
    type: 'gas_leak',
    titles: [
      'Gas smell reported',
      'Gas detector above threshold',
      'Suspected leak near a supply line',
    ],
    description: 'Detector or staff report of gas; keep clear of the area until cleared.',
    zoneKinds: ['building', 'utility'],
    weight: 1,
  },
  {
    type: 'hazmat_spill',
    titles: [
      'Chemical spill reported',
      'Container leaking in storage',
      'Unknown substance on the floor',
    ],
    description: 'Hazardous substance spilled; area to be isolated until cleaned.',
    zoneKinds: ['building', 'utility'],
    weight: 1,
  },
  {
    type: 'injury',
    titles: [
      'Student fell and is injured',
      'Sports injury reported',
      'Staff member hurt while lifting',
    ],
    description: 'Injury reported on site; first aider requested.',
    zoneKinds: ['outdoor', 'building', 'sports', 'parking'],
    weight: 3,
  },
  {
    type: 'power_outage',
    titles: ['Power lost in the building', 'Circuit breaker tripped', 'Backup power engaged'],
    description: 'Mains supply interrupted; check the distribution board.',
    zoneKinds: ['building', 'utility'],
    weight: 2,
  },
  {
    type: 'water_leak',
    titles: ['Water leak reported', 'Pipe burst in a utility room', 'Ceiling dripping'],
    description: 'Water escaping from a pipe or fixture; shut-off may be needed.',
    zoneKinds: ['building', 'utility'],
    weight: 3,
  },
  {
    type: 'lift_entrapment',
    titles: ['People trapped in a lift', 'Lift stopped between floors', 'Lift alarm activated'],
    description: 'Passengers inside a stalled lift; do not force the doors.',
    zoneKinds: ['building'],
    weight: 1,
  },
  {
    type: 'hvac_fault',
    titles: ['Air conditioning not cooling', 'Ventilation fan fault', 'Temperature above setpoint'],
    description: 'Climate control reports a fault; equipment or comfort limits at risk.',
    zoneKinds: ['building'],
    weight: 2,
  },
  {
    type: 'network_outage',
    titles: [
      'Network switch unreachable',
      'Wi-Fi down in the building',
      'Uplink to the data center lost',
    ],
    description: 'Connectivity lost; heartbeat from the switch missed.',
    zoneKinds: ['building', 'gate'],
    weight: 2,
  },
  {
    type: 'severe_weather',
    titles: [
      'Severe weather warning issued',
      'Strong winds reported',
      'Heavy rain and lightning nearby',
    ],
    description: 'Weather warning for the campus area; outdoor activity may need to stop.',
    zoneKinds: ['outdoor', 'sports', 'parking', 'water'],
    weight: 1,
  },
  {
    type: 'flooding',
    titles: ['Water pooling after heavy rain', 'Drain overflow reported', 'Low area flooded'],
    description: 'Standing water reported; access routes may be affected.',
    zoneKinds: ['water', 'outdoor', 'parking', 'utility'],
    weight: 1,
  },
  {
    type: 'fallen_tree',
    titles: ['Tree fallen across a path', 'Large branch down', 'Tree leaning after strong wind'],
    description: 'Obstruction reported; keep clear until it is cut away.',
    zoneKinds: ['outdoor', 'parking', 'sports'],
    weight: 1,
  },
  {
    type: 'traffic_accident',
    titles: [
      'Minor collision in the car park',
      'Vehicle hit a barrier arm',
      'Collision at a junction',
    ],
    description: 'Vehicle collision reported; check for injuries.',
    zoneKinds: ['parking', 'gate'],
    weight: 2,
  },
  {
    type: 'blocked_access',
    titles: [
      'Fire lane blocked by a delivery van',
      'Gate blocked by a stopped vehicle',
      'Entrance obstructed',
    ],
    description: 'Access route obstructed; vehicle owner not found.',
    zoneKinds: ['parking', 'gate'],
    weight: 3,
  },
];

export const SCENARIOS: Scenario[] = DEFINITIONS.map((definition) => ({
  ...definition,
  severity: INCIDENT_TYPE_DEFAULT_SEVERITY[definition.type],
}));

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
