import { InvalidTransitionError } from '../common/domain-errors';
import { IncidentEntity } from './incident.entity';

const reportedAt = new Date('2026-10-01T08:00:00Z');
const later = (minutes: number) => new Date(reportedAt.getTime() + minutes * 60_000);

const newIncident = () =>
  IncidentEntity.report({
    code: 'INC-000001',
    type: 'intrusion',
    severity: 'high',
    title: 'Door forced open',
    zoneId: 'zone-1',
    lng: 108.44,
    lat: 11.95,
    source: 'operator',
    at: reportedAt,
  });

describe('IncidentEntity lifecycle', () => {
  it('starts open with a "reported" timeline entry', () => {
    const incident = newIncident();

    expect(incident.status).toBe('open');
    expect(incident.description).toBeNull();
    expect(incident.pendingEvents.map((e) => e.kind)).toEqual(['reported']);
  });

  it('acknowledges an open incident and records who/when on the timeline', () => {
    const incident = newIncident();
    incident.acknowledge(later(2), 'Guard dispatched');

    expect(incident.status).toBe('acknowledged');
    expect(incident.acknowledgedAt).toEqual(later(2));
    expect(incident.pendingEvents.at(-1)).toMatchObject({
      kind: 'acknowledged',
      note: 'Guard dispatched',
    });
  });

  it('resolves from open or acknowledged', () => {
    const direct = newIncident();
    direct.resolve(later(1));
    expect(direct.status).toBe('resolved');

    const handled = newIncident();
    handled.acknowledge(later(1));
    handled.resolve(later(5), 'False alarm');
    expect(handled.status).toBe('resolved');
    expect(handled.resolvedAt).toEqual(later(5));
    expect(handled.pendingEvents.map((e) => e.kind)).toEqual([
      'reported',
      'acknowledged',
      'resolved',
    ]);
  });

  it.each([
    [
      'acknowledge an acknowledged incident',
      (i: IncidentEntity) => (i.acknowledge(later(1)), () => i.acknowledge(later(2))),
    ],
    [
      'acknowledge a resolved incident',
      (i: IncidentEntity) => (i.resolve(later(1)), () => i.acknowledge(later(2))),
    ],
    [
      'resolve a resolved incident',
      (i: IncidentEntity) => (i.resolve(later(1)), () => i.resolve(later(2))),
    ],
  ])('refuses to %s', (_, arrange) => {
    const incident = newIncident();
    const act = arrange(incident);

    expect(act).toThrow(InvalidTransitionError);
  });

  it('exposes the shared contract with ISO timestamps and [lng, lat]', () => {
    const incident = newIncident();
    incident.id = 'id-1';

    expect(incident.toContract()).toMatchObject({
      id: 'id-1',
      position: [108.44, 11.95],
      reportedAt: '2026-10-01T08:00:00.000Z',
      acknowledgedAt: null,
      resolvedAt: null,
    });
  });
});
