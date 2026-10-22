import { InvalidTransitionError } from '../common/domain-errors';
import { SystemActors } from './actors';
import { IncidentEntity } from './incident.entity';

const actor = SystemActors.seed;

const reportedAt = new Date('2026-10-01T08:00:00Z');
const later = (minutes: number) => new Date(reportedAt.getTime() + minutes * 60_000);

const newIncident = () =>
  IncidentEntity.report(
    {
      code: 'INC-000001',
      type: 'intrusion',
      severity: 'high',
      title: 'Door forced open',
      zoneId: 'zone-1',
      lng: 108.44,
      lat: 11.95,
      source: 'operator',
      at: reportedAt,
    },
    actor,
  );

describe('IncidentEntity lifecycle', () => {
  it('starts open with a "reported" timeline entry', () => {
    const incident = newIncident();

    expect(incident.status).toBe('open');
    expect(incident.description).toBeNull();
    expect(incident.pendingEvents.map((e) => e.kind)).toEqual(['reported']);
  });

  it('acknowledges an open incident and records who/when on the timeline', () => {
    const incident = newIncident();
    incident.acknowledge(later(2), actor, 'Guard dispatched');

    expect(incident.status).toBe('acknowledged');
    expect(incident.acknowledgedAt).toEqual(later(2));
    expect(incident.pendingEvents.at(-1)).toMatchObject({
      kind: 'acknowledged',
      note: 'Guard dispatched',
    });
  });

  it('resolves from open or acknowledged', () => {
    const direct = newIncident();
    direct.resolve(later(1), actor);
    expect(direct.status).toBe('resolved');

    const handled = newIncident();
    handled.acknowledge(later(1), actor);
    handled.resolve(later(5), actor, 'False alarm');
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
      (i: IncidentEntity) => (i.acknowledge(later(1), actor), () => i.acknowledge(later(2), actor)),
    ],
    [
      'acknowledge a resolved incident',
      (i: IncidentEntity) => (i.resolve(later(1), actor), () => i.acknowledge(later(2), actor)),
    ],
    [
      'resolve a resolved incident',
      (i: IncidentEntity) => (i.resolve(later(1), actor), () => i.resolve(later(2), actor)),
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

describe('IncidentEntity.report with a telemetry link', () => {
  const props = {
    code: 'INC-000002',
    type: 'equipment_fault' as const,
    severity: 'critical' as const,
    title: 'Motor over-temperature — Cooling tower 01',
    zoneId: 'zone-1',
    lng: 108.44,
    lat: 11.95,
    source: 'telemetry' as const,
    at: reportedAt,
  };

  it('records the evidence as the note of the reported entry', () => {
    const incident = IncidentEntity.report(
      { ...props, note: 'motorTempC 92 > 85 for 60 s' },
      SystemActors.telemetry,
    );

    expect(incident.pendingEvents).toHaveLength(1);
    expect(incident.pendingEvents[0]).toMatchObject({
      kind: 'reported',
      note: 'motorTempC 92 > 85 for 60 s',
      actorKind: 'system',
      actorSubject: 'telemetry',
      actorName: 'Telemetry rule',
    });
  });

  it('keeps the note off the entity: it is not a column', () => {
    const incident = IncidentEntity.report({ ...props, note: 'evidence' }, SystemActors.telemetry);

    expect(incident).not.toHaveProperty('note');
  });

  it('keeps the asset and the rule that raised it and exposes the asset', () => {
    const incident = IncidentEntity.report(
      { ...props, assetId: 'asset-1', telemetryRuleId: 'rule-1' },
      SystemActors.telemetry,
    );
    incident.id = 'id-2';

    expect(incident.assetId).toBe('asset-1');
    expect(incident.telemetryRuleId).toBe('rule-1');
    expect(incident.toContract()).toMatchObject({ source: 'telemetry', assetId: 'asset-1' });
  });

  it('keeps the level it was reported on and exposes it', () => {
    const incident = IncidentEntity.report({ ...props, levelCode: 'L2' }, SystemActors.telemetry);
    incident.id = 'id-3';

    expect(incident.levelCode).toBe('L2');
    expect(incident.toContract().levelCode).toBe('L2');
  });

  it('has no level unless one was given', () => {
    const incident = IncidentEntity.report(props, SystemActors.telemetry);
    incident.id = 'id-4';

    expect(incident.levelCode).toBeNull();
    expect(incident.toContract().levelCode).toBeNull();
  });

  it('has no asset, rule or note for an incident that is not from a rule', () => {
    const incident = newIncident();
    incident.id = 'id-1';

    expect(incident.assetId).toBeNull();
    expect(incident.telemetryRuleId).toBeNull();
    expect(incident.toContract().assetId).toBeNull();
    expect(incident.pendingEvents[0]?.note).toBeNull();
  });
});
