import { BuildingLevelEntity } from './building-level.entity';
import { ZoneEntity } from './zone.entity';

const level = (over: Partial<BuildingLevelEntity> = {}): BuildingLevelEntity =>
  Object.assign(new BuildingLevelEntity(), {
    zoneId: 'zone-1',
    code: 'L2',
    label: 'Level 2',
    elevationM: 4,
    sort: 2,
    ...over,
  });

const zone = (levels?: BuildingLevelEntity[]): ZoneEntity =>
  Object.assign(new ZoneEntity(), {
    id: 'zone-1',
    code: 'SCI',
    name: 'Science Lab',
    kind: 'building' as const,
    use: 'lab' as const,
    heightM: 12,
    polygon: [],
    centerLng: 108.44,
    centerLat: 11.95,
    levels,
  });

describe('BuildingLevelEntity.toContract()', () => {
  it('maps the code, the label and the height of the slab, and nothing else', () => {
    expect(level().toContract()).toEqual({ code: 'L2', label: 'Level 2', elevationM: 4 });
  });
});

describe('ZoneEntity.toContract() with levels', () => {
  it('lists the levels from the lowest, whatever order the relation holds them in', () => {
    const levels = [
      level({ code: 'ROOF', label: 'Roof', elevationM: 12, sort: 4 }),
      level({ code: 'L1', label: 'Level 1', elevationM: 0, sort: 1 }),
      level(),
    ];

    expect(
      zone(levels)
        .toContract()
        .levels?.map((l) => l.code),
    ).toEqual(['L1', 'L2', 'ROOF']);
  });

  it('does not reorder the relation it was given', () => {
    const levels = [level({ code: 'L3', sort: 3 }), level({ code: 'L1', sort: 1 })];

    zone(levels).toContract();

    expect(levels.map((l) => l.code)).toEqual(['L3', 'L1']);
  });

  it('gives an empty list for a zone whose relation is loaded and empty', () => {
    expect(zone([]).toContract().levels).toEqual([]);
  });

  it('leaves `levels` out when the relation was not loaded: it must not pass for "no levels"', () => {
    expect(zone(undefined).toContract()).not.toHaveProperty('levels');
  });
});
