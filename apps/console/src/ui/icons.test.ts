import {
  ACTOR_KINDS,
  INCIDENT_CATEGORIES,
  INCIDENT_EVENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  type IncidentCategory,
  type IncidentType,
  ZONE_KINDS,
  type ZoneKind,
} from '@occ/contracts';
import {
  actorKindIcon,
  assetClassIcon,
  assetStateIcon,
  cameraIcon,
  categoryIcon,
  connectionIcon,
  eventKindIcon,
  Fan,
  type Glyph,
  incidentTypeIcon,
  severityIcon,
  statusIcon,
  telemetryIcon,
  Thermometer,
  unknownIcon,
  zoneKindIcon,
  Zap,
} from './icons';

// The `Record` types already make every map complete; what they cannot catch is two values of one
// domain sharing a glyph by a copy-paste slip, which would make them indistinguishable.
describe('icon maps', () => {
  it.each([
    ['severity', INCIDENT_SEVERITIES.map(severityIcon)],
    ['incident type', INCIDENT_TYPES.map(incidentTypeIcon)],
    ['category', INCIDENT_CATEGORIES.map(categoryIcon)],
    ['status', INCIDENT_STATUSES.map(statusIcon)],
    ['event kind', INCIDENT_EVENT_KINDS.map(eventKindIcon)],
    ['zone kind', ZONE_KINDS.map(zoneKindIcon)],
    ['actor kind', ACTOR_KINDS.map(actorKindIcon)],
    ['connection', (['connecting', 'live', 'offline'] as const).map(connectionIcon)],
    ['camera', [true, false].map(cameraIcon)],
  ])('gives every %s its own glyph', (_domain, glyphs) => {
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

// The one pair that shares a glyph by design: both are a link being made, told apart by the label.
describe('connection glyphs', () => {
  it('shares the refresh glyph between the first connect and a reconnect, on purpose', () => {
    expect(connectionIcon('connecting')).toBe(connectionIcon('reconnecting'));
  });

  it('gives live, reconnecting and offline their own glyphs', () => {
    const glyphs = (['live', 'reconnecting', 'offline'] as const).map(connectionIcon);
    expect(new Set(glyphs).size).toBe(3);
  });
});

// The `Telemetry` pill and banner (V2-08.1): a link being made or lost reads as the Live pill's.
describe('telemetry glyphs', () => {
  it('gives live, paused, reconnecting and unavailable their own glyphs', () => {
    const glyphs = (['live', 'paused', 'reconnecting', 'unavailable'] as const).map(telemetryIcon);
    expect(new Set(glyphs).size).toBe(4);
  });

  it('draws a link being made, or lost, as the Live pill does', () => {
    expect(telemetryIcon('connecting')).toBe(connectionIcon('connecting'));
    expect(telemetryIcon('reconnecting')).toBe(connectionIcon('reconnecting'));
    expect(telemetryIcon('unavailable')).toBe(connectionIcon('offline'));
  });
});

// A newer API can send a value this build's contract lacks (ADR-0021, rolling deploys); the type
// system cannot model it, hence the casts.
describe('unknown values', () => {
  const UNKNOWN = 'not_in_contract';

  it('draws an unknown type, category or zone kind with the generic glyph', () => {
    expect(incidentTypeIcon(UNKNOWN as IncidentType)).toBe(unknownIcon);
    expect(categoryIcon(UNKNOWN as IncidentCategory)).toBe(unknownIcon);
    expect(zoneKindIcon(UNKNOWN as ZoneKind)).toBe(unknownIcon);
  });

  it('never uses the generic glyph for a known type, category or zone kind', () => {
    const known = [
      ...INCIDENT_TYPES.map(incidentTypeIcon),
      ...INCIDENT_CATEGORIES.map(categoryIcon),
      ...ZONE_KINDS.map(zoneKindIcon),
    ];
    expect(known).not.toContain(unknownIcon);
  });
});

// The 16 classes of asset-classes.md § Classes. A class code is a plain string in the contract and
// the console may not import the API's seed, so this list is the only exhaustiveness check: keep it
// in step with the catalogue by hand.
const ASSET_CLASS_CODES = [
  'cooling_tower',
  'standby_generator',
  'ups',
  'ups_battery',
  'precision_cooling',
  'transformer',
  'switchgear',
  'chiller',
  'air_handler',
  'booster_pump',
  'lift',
  'barrier_arm',
  'fume_hood',
  'gas_detector',
  'leak_sensor',
  'indoor_climate',
] as const;

const sorted = (groups: string[][]): string[][] =>
  groups.map((group) => [...group].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!));

describe('asset class glyphs', () => {
  it('gives each of the 16 classes a glyph, never the generic one', () => {
    for (const code of ASSET_CLASS_CODES) {
      expect(assetClassIcon(code), code).not.toBe(unknownIcon);
    }
  });

  // The "own glyph" idiom above cannot be used here: the shares are deliberate. This pins them, so a
  // share that is not written in icons.md (or a slip that merges two unrelated classes) fails.
  it('shares a glyph only where the meaning is the same', () => {
    const byGlyph = new Map<Glyph, string[]>();
    for (const code of ASSET_CLASS_CODES) {
      const glyph = assetClassIcon(code);
      byGlyph.set(glyph, [...(byGlyph.get(glyph) ?? []), code]);
    }

    expect(sorted([...byGlyph.values()])).toEqual(
      sorted([
        ['cooling_tower', 'fume_hood', 'air_handler'], // air handling
        ['ups', 'transformer'], // electric supply
        ['standby_generator', 'switchgear'], // a power source or switching
        ['precision_cooling', 'chiller', 'indoor_climate'], // temperature control or measurement
        ['ups_battery'],
        ['lift'],
        ['barrier_arm'],
        ['leak_sensor'],
        ['gas_detector'],
        ['booster_pump'],
      ]),
    );
  });

  it('uses the glyph of the incident type or zone kind that means the same', () => {
    expect(assetClassIcon('lift')).toBe(incidentTypeIcon('lift_entrapment'));
    expect(assetClassIcon('leak_sensor')).toBe(incidentTypeIcon('water_leak'));
    expect(assetClassIcon('gas_detector')).toBe(incidentTypeIcon('gas_leak'));
    expect(assetClassIcon('barrier_arm')).toBe(zoneKindIcon('gate'));
    expect(assetClassIcon('cooling_tower')).toBe(incidentTypeIcon('hvac_fault'));
    expect(assetClassIcon('ups')).toBe(incidentTypeIcon('power_outage'));
  });

  it('draws the temperature classes, the fan classes and the electric classes as named', () => {
    expect(assetClassIcon('chiller')).toBe(Thermometer);
    expect(assetClassIcon('air_handler')).toBe(Fan);
    expect(assetClassIcon('transformer')).toBe(Zap);
  });

  it('never gives a class the glyph of a state, so "Running" never reads as a pump', () => {
    const stateGlyphs = (['running', 'standby', 'nodata', 'offline'] as const).map(assetStateIcon);
    for (const code of ASSET_CLASS_CODES) {
      expect(stateGlyphs, code).not.toContain(assetClassIcon(code));
    }
  });

  // A newer API can send a class this build lacks; the contract types the code as a plain string.
  it.each(['hovercraft', '', 'constructor', '__proto__', 'toString'])(
    'draws the class %j with the generic glyph',
    (code) => {
      expect(assetClassIcon(code)).toBe(unknownIcon);
    },
  );
});

describe('asset state glyphs', () => {
  // The two shares of the pill, on purpose: a live signal and an operating asset; a paused feed and
  // an asset on hold. The state word beside the glyph tells them apart.
  it('draws Running and Standby as the telemetry pill draws live and paused', () => {
    expect(assetStateIcon('running')).toBe(telemetryIcon('live'));
    expect(assetStateIcon('standby')).toBe(telemetryIcon('paused'));
  });

  it('draws No data and Offline with one glyph: the same look, told apart by the label', () => {
    expect(assetStateIcon('nodata')).toBe(assetStateIcon('offline'));
  });

  it('gives running, standby and no data glyphs of their own', () => {
    const glyphs = (['running', 'standby', 'nodata'] as const).map(assetStateIcon);
    expect(new Set(glyphs).size).toBe(3);
  });

  it('keeps the no-data glyph to the asset states: no telemetry pill state draws it', () => {
    const pill = (['connecting', 'live', 'paused', 'reconnecting', 'unavailable'] as const).map(
      telemetryIcon,
    );
    expect(pill).not.toContain(assetStateIcon('nodata'));
  });

  it('never gives a state the generic glyph', () => {
    const glyphs = (['running', 'standby', 'nodata', 'offline'] as const).map(assetStateIcon);
    expect(glyphs).not.toContain(unknownIcon);
  });
});
