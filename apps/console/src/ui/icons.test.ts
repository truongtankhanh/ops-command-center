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
  cameraIcon,
  categoryIcon,
  connectionIcon,
  eventKindIcon,
  incidentTypeIcon,
  severityIcon,
  statusIcon,
  unknownIcon,
  zoneKindIcon,
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
