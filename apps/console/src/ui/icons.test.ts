import {
  ACTOR_KINDS,
  INCIDENT_EVENT_KINDS,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  ZONE_KINDS,
} from '@occ/contracts';
import {
  actorKindIcon,
  cameraIcon,
  connectionIcon,
  eventKindIcon,
  incidentTypeIcon,
  severityIcon,
  statusIcon,
  zoneKindIcon,
} from './icons';

// The `Record` types already make every map complete; what they cannot catch is two values of one
// domain sharing a glyph by a copy-paste slip, which would make them indistinguishable.
describe('icon maps', () => {
  it.each([
    ['severity', INCIDENT_SEVERITIES.map(severityIcon)],
    ['incident type', INCIDENT_TYPES.map(incidentTypeIcon)],
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
