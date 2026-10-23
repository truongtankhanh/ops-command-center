import type { Asset, LngLat, SitePlan, Zone } from '@occ/contracts';
import { offsetM } from './map/geo';
import {
  type ClassProgress,
  formatProgress,
  loadTarget,
  modelClasses,
  modelSteps,
  QUEUED,
} from './twinLoadQueue';

const CENTER: LngLat = [108.4415, 11.953];

/** An asset of class `classCode`, `east` / `north` metres from the centre. */
function asset(
  code: string,
  classCode: string,
  east: number,
  north: number,
  modelUrl: string | null = `/models/${classCode}.0123456789ab.glb`,
): Asset {
  return {
    id: code,
    code,
    name: code,
    class: {
      id: classCode,
      code: classCode,
      name: classCode === 'cooling_tower' ? 'Cooling tower' : classCode,
      modelUrl,
      footprintM: { width: 1, depth: 1, height: 1 },
    },
    zoneId: 'Z',
    position: offsetM(CENTER, east, north),
    elevationM: 0,
    headingDeg: 0,
    headline: [],
  };
}

describe('loadTarget', () => {
  const zone = (west: number, south: number, east: number, north: number): Zone => ({
    id: 'z',
    code: 'Z',
    name: 'Z',
    kind: 'building',
    polygon: [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
    center: [(west + east) / 2, (south + north) / 2],
  });

  it('is the middle of the zones when there is no plan', () => {
    expect(loadTarget(undefined, [zone(10, 20, 14, 28)])).toEqual([12, 24]);
  });

  it('is the middle of the plan’s boundary and the zones together', () => {
    const plan: SitePlan = {
      id: 'p',
      code: 'P',
      name: 'P',
      center: [0, 0],
      features: [
        {
          part: 'boundary',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
                [0, 0],
              ],
            ],
          },
        },
      ],
    };
    expect(loadTarget(plan, [])).toEqual([5, 5]);
    expect(loadTarget(plan, [zone(0, 0, 20, 10)])).toEqual([10, 5]);
  });

  it('is null when there is nothing to measure from', () => {
    expect(loadTarget(undefined, [])).toBeNull();
  });
});

describe('modelClasses', () => {
  it('lists only the classes that have a model, with how many assets each has', () => {
    const classes = modelClasses(
      [
        asset('CT-02', 'cooling_tower', 20, 0),
        asset('CT-01', 'cooling_tower', 10, 0),
        asset('UPS-01', 'ups', 0, 0, null),
      ],
      CENTER,
    );

    expect(classes).toHaveLength(1);
    expect(classes[0]).toMatchObject({
      code: 'cooling_tower',
      name: 'Cooling tower',
      modelUrl: '/models/cooling_tower.0123456789ab.glb',
      assetCount: 2,
    });
  });

  it('names the first asset by code as the one whose detail holds the points', () => {
    const [tower] = modelClasses(
      [asset('CT-02', 'cooling_tower', 20, 0), asset('CT-01', 'cooling_tower', 10, 0)],
      CENTER,
    );
    expect(tower?.representative).toBe('CT-01');
  });

  it('puts the class nearest the target first, by its nearest asset', () => {
    const classes = modelClasses(
      [
        asset('GEN-01', 'standby_generator', 40, 0),
        asset('CT-01', 'cooling_tower', 100, 0),
        asset('CT-02', 'cooling_tower', 30, 0),
      ],
      CENTER,
    );

    expect(classes.map((c) => c.code)).toEqual(['cooling_tower', 'standby_generator']);
    expect(classes[0]?.distanceM).toBeCloseTo(30, 1);
    expect(classes[1]?.distanceM).toBeCloseTo(40, 1);
  });

  it('counts an asset that is not drawn at campus level too', () => {
    const [tower] = modelClasses([asset('CT-01', 'cooling_tower', 500, 0)], CENTER);
    expect(tower?.assetCount).toBe(1);
  });

  it('breaks a tie by class code', () => {
    const classes = modelClasses(
      [asset('B-1', 'b_class', 10, 0), asset('A-1', 'a_class', 10, 0)],
      CENTER,
    );
    expect(classes.map((c) => c.code)).toEqual(['a_class', 'b_class']);
  });

  it('goes by class code when there is no target', () => {
    const classes = modelClasses(
      [asset('B-1', 'b_class', 1, 0), asset('A-1', 'a_class', 900, 0)],
      null,
    );
    expect(classes.map((c) => c.code)).toEqual(['a_class', 'b_class']);
  });

  it('gives nothing for no assets or a catalogue with no model', () => {
    expect(modelClasses([], CENTER)).toEqual([]);
    expect(modelClasses([asset('UPS-01', 'ups', 0, 0, null)], CENTER)).toEqual([]);
  });

  it('does not depend on the order it is given', () => {
    const assets = [
      asset('CT-01', 'cooling_tower', 10, 0),
      asset('GEN-01', 'standby_generator', 40, 0),
      asset('CT-02', 'cooling_tower', 20, 0),
    ];
    expect(modelClasses([...assets].reverse(), CENTER)).toEqual(modelClasses(assets, CENTER));
  });
});

describe('formatProgress', () => {
  it('says megabytes with one decimal for a file of a megabyte or more', () => {
    expect(formatProgress(600_000, 1_400_000)).toBe('0.6 / 1.4 MB');
    expect(formatProgress(1_400_000, 1_400_000)).toBe('1.4 / 1.4 MB');
  });

  it('says kilobytes for a file under a megabyte, in the unit of the larger number', () => {
    expect(formatProgress(10_500, 21_120)).toBe('11 / 21 kB');
    expect(formatProgress(0, 21_120)).toBe('0 / 21 kB');
  });

  it('says only the bytes so far when the total is unknown', () => {
    expect(formatProgress(2_500_000, 0)).toBe('2.5 MB');
    expect(formatProgress(40_000, 0)).toBe('40 kB');
  });
});

describe('modelSteps', () => {
  const tower = modelClasses(
    [asset('CT-01', 'cooling_tower', 10, 0), asset('CT-02', 'cooling_tower', 20, 0)],
    CENTER,
  );
  const stepFor = (progress: ClassProgress) => modelSteps(tower, { cooling_tower: progress })[0];

  it('has a row per class, labelled with the name and how many assets', () => {
    const steps = modelSteps(tower, {});
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ id: 'model:cooling_tower', label: 'Cooling tower × 2' });
  });

  it('keeps the order of the classes', () => {
    const classes = modelClasses(
      [asset('GEN-01', 'standby_generator', 40, 0), asset('CT-01', 'cooling_tower', 10, 0)],
      CENTER,
    );
    expect(modelSteps(classes, {}).map((step) => step.id)).toEqual([
      'model:cooling_tower',
      'model:standby_generator',
    ]);
  });

  it('is queued with no progress at all', () => {
    expect(stepFor(QUEUED)).toMatchObject({ state: 'queued', detail: 'queued' });
    expect(modelSteps(tower, {})[0]).toMatchObject({ state: 'queued', detail: 'queued' });
  });

  it('is active with its bytes while it loads', () => {
    expect(stepFor({ state: 'loading', loaded: 600_000, total: 1_400_000 })).toMatchObject({
      state: 'active',
      detail: '0.6 / 1.4 MB',
    });
    expect(stepFor({ state: 'loading', loaded: 0, total: 0 })).toMatchObject({
      state: 'active',
      detail: '0 kB',
    });
  });

  it('is done with its size once it is ready', () => {
    expect(stepFor({ state: 'ready', loaded: 21_120, total: 21_120 })).toMatchObject({
      state: 'done',
      detail: '21 kB',
    });
    expect(stepFor({ state: 'ready', loaded: 1_400_000, total: 0 })).toMatchObject({
      state: 'done',
      detail: '1.4 MB',
    });
    expect(stepFor({ state: 'ready', loaded: 0, total: 0 })).toMatchObject({
      state: 'done',
      detail: 'ready',
    });
  });

  it('is done, not failed, when the model failed: the box stays and the card must close', () => {
    expect(stepFor({ state: 'failed', loaded: 0, total: 0 })).toMatchObject({
      state: 'done',
      detail: 'drawn as a box',
    });
  });

  it('has no rows for no classes', () => {
    expect(modelSteps([], {})).toEqual([]);
  });
});
