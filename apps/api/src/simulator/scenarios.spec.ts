import { pickWeighted, scenariosFor } from './scenarios';

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

describe('scenariosFor', () => {
  it('only offers fire alarms inside buildings', () => {
    expect(scenariosFor('building').some((s) => s.type === 'fire_alarm')).toBe(true);
    expect(scenariosFor('parking').some((s) => s.type === 'fire_alarm')).toBe(false);
  });

  it('has at least one scenario for every zone kind', () => {
    for (const kind of ['building', 'parking', 'gate', 'outdoor'] as const) {
      expect(scenariosFor(kind).length).toBeGreaterThan(0);
    }
  });
});
