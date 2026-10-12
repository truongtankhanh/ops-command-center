import { INCIDENT_TYPE_DEFAULT_SEVERITY, INCIDENT_TYPES, ZONE_KINDS } from '@occ/contracts';
import { pickWeighted, SCENARIOS, scenariosFor } from './scenarios';

describe('pickWeighted', () => {
  const items = [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 3 },
  ];

  it('maps the random roll onto cumulative weights', () => {
    expect(pickWeighted(items, () => 0).id).toBe('a');
    expect(pickWeighted(items, () => 0.24).id).toBe('a');
    expect(pickWeighted(items, () => 0.26).id).toBe('b');
    expect(pickWeighted(items, () => 0.999).id).toBe('b');
  });
});

describe('SCENARIOS', () => {
  it('has exactly one scenario for every incident type', () => {
    const types = SCENARIOS.map((scenario) => scenario.type);

    expect(types).toHaveLength(INCIDENT_TYPES.length);
    expect([...types].sort()).toEqual([...INCIDENT_TYPES].sort());
  });

  it("takes each type's default severity, so the simulated fire alarm is high", () => {
    for (const { type, severity } of SCENARIOS) {
      expect([type, severity]).toEqual([type, INCIDENT_TYPE_DEFAULT_SEVERITY[type]]);
    }
    // A literal, so the V2-04.4 outcome (Open question 15) cannot drift with the contract.
    expect(SCENARIOS.find((scenario) => scenario.type === 'fire_alarm')?.severity).toBe('high');
  });

  it('keeps the demo producing critical incidents, in buildings', () => {
    const critical = SCENARIOS.filter((scenario) => scenario.severity === 'critical');

    expect(critical.map((scenario) => scenario.type).sort()).toEqual(['fire', 'gas_leak']);
    for (const scenario of critical) expect(scenario.zoneKinds).toContain('building');
  });

  it('fits the incident columns and has a usable weight', () => {
    for (const { type, titles, description, weight } of SCENARIOS) {
      // `incident.title` is varchar(160); the description is capped at 2000 by the report DTO,
      // which the simulator bypasses.
      expect([type, titles.length > 0]).toEqual([type, true]);
      for (const title of titles) expect([type, title.length <= 160]).toEqual([type, true]);
      expect([type, description.length <= 2000]).toEqual([type, true]);
      expect([type, weight > 0]).toEqual([type, true]);
    }
  });
});

describe('scenariosFor', () => {
  it('only offers fire alarms inside buildings', () => {
    expect(scenariosFor('building').some((s) => s.type === 'fire_alarm')).toBe(true);
    expect(scenariosFor('parking').some((s) => s.type === 'fire_alarm')).toBe(false);
  });

  it('has at least one scenario for every zone kind', () => {
    for (const kind of ZONE_KINDS) {
      expect([kind, scenariosFor(kind).length > 0]).toEqual([kind, true]);
    }
  });

  it('offers the kinds with no V1 scenario their typical incidents', () => {
    const typesOf = (kind: (typeof ZONE_KINDS)[number]) =>
      scenariosFor(kind).map((scenario) => scenario.type);

    expect(typesOf('utility')).toEqual(expect.arrayContaining(['power_outage', 'intrusion']));
    expect(typesOf('water')).toEqual(expect.arrayContaining(['medical', 'flooding']));
    expect(typesOf('sports')).toEqual(expect.arrayContaining(['injury', 'crowding']));
  });
});
