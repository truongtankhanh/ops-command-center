import { categoryOf } from '@occ/contracts';
import {
  ASSET_CLASSES,
  missingFromCatalogue,
  pointRef,
  ruleRef,
  type ClassSeed,
} from './asset-catalogue';

/** Every seed point with its class, for the checks that look at points one by one. */
const POINTS = ASSET_CLASSES.flatMap((assetClass) =>
  assetClass.points.map((point) => ({ assetClass, point })),
);
const RULES = ASSET_CLASSES.flatMap((assetClass) =>
  assetClass.rules.map((rule) => ({ assetClass, rule })),
);

/** The sets a database holding exactly `classes` would give, mutable so a case can take rows away. */
const presentOf = (classes: readonly ClassSeed[] = ASSET_CLASSES) => ({
  classes: new Set(classes.map((assetClass) => assetClass.code)),
  points: new Set(
    classes.flatMap((assetClass) =>
      assetClass.points.map((point) => pointRef(assetClass.code, point.key)),
    ),
  ),
  rules: new Set(
    classes.flatMap((assetClass) =>
      assetClass.rules.map((rule) => ruleRef(assetClass.code, rule.name)),
    ),
  ),
});

const codeOf = (assetClass: ClassSeed) => assetClass.code;

describe('asset catalogue seed', () => {
  it('has sixteen classes, sixty-six points and twenty-two rules', () => {
    // Literals, so a change is a conscious edit (the e2e seed case counts the rows too).
    expect(ASSET_CLASSES).toHaveLength(16);
    expect(POINTS).toHaveLength(66);
    expect(RULES).toHaveLength(22);
  });

  it('holds the points and the rules asset-classes.md gives each class', () => {
    const counts = Object.fromEntries(
      ASSET_CLASSES.map((c) => [c.code, [c.points.length, c.rules.length]]),
    );
    expect(counts).toEqual({
      cooling_tower: [12, 3],
      standby_generator: [10, 3],
      ups: [5, 2],
      ups_battery: [3, 1],
      precision_cooling: [4, 1],
      transformer: [3, 2],
      switchgear: [4, 1],
      chiller: [4, 1],
      air_handler: [4, 1],
      booster_pump: [2, 1],
      lift: [4, 1],
      barrier_arm: [2, 1],
      fume_hood: [3, 1],
      gas_detector: [2, 1],
      leak_sensor: [2, 2],
      indoor_climate: [2, 0],
    });
  });

  it('has unique class codes, unique point keys per class and unique rule names per class', () => {
    const codes = ASSET_CLASSES.map(codeOf);
    expect(new Set(codes).size).toBe(codes.length);
    for (const { code, points, rules } of ASSET_CLASSES) {
      const keys = points.map((point) => point.key);
      const names = rules.map((rule) => rule.name);
      expect([code, new Set(keys).size]).toEqual([code, keys.length]);
      expect([code, new Set(names).size]).toEqual([code, names.length]);
    }
  });

  it('leaves model_key null: V2-13 sets it for the two modelled classes', () => {
    for (const { code, modelKey } of ASSET_CLASSES) {
      expect([code, modelKey]).toEqual([code, null]);
    }
  });

  it('writes classes the database accepts', () => {
    // `asset_class_code_check`, `name` varchar(120), `asset_class_footprint_check`.
    for (const { code, name, footprintM } of ASSET_CLASSES) {
      expect([code, /^[a-z][a-z0-9_]{1,31}$/.test(code)]).toEqual([code, true]);
      expect([code, name.length > 0 && name.length <= 120]).toEqual([code, true]);
      for (const side of [footprintM.width, footprintM.depth, footprintM.height]) {
        expect([code, side > 0]).toEqual([code, true]);
      }
    }
  });

  it('writes points the database accepts', () => {
    // `telemetry_point_key_check`, `label` varchar(120), `unit` varchar(16), the interval and
    // headline checks.
    for (const { assetClass, point } of POINTS) {
      const at = `${assetClass.code}.${point.key}`;
      expect([at, /^[a-z][A-Za-z0-9]{0,62}$/.test(point.key)]).toEqual([at, true]);
      expect([at, point.label.length > 0 && point.label.length <= 120]).toEqual([at, true]);
      expect([
        at,
        point.unit === null || (point.unit.length > 0 && point.unit.length <= 16),
      ]).toEqual([at, true]);
      expect([
        at,
        Number.isInteger(point.expectedIntervalS) && point.expectedIntervalS > 0,
      ]).toEqual([at, true]);
      expect([at, [null, 1, 2].includes(point.headline)]).toEqual([at, true]);
    }
  });

  it('gives a range to number points only, and values to enum points only', () => {
    for (const { assetClass, point } of POINTS) {
      const at = `${assetClass.code}.${point.key}`;
      if (point.kind === 'number') {
        expect([at, point.min !== null, point.enumValues]).toEqual([at, true, null]);
        if (point.max !== null) expect([at, point.min! <= point.max]).toEqual([at, true]);
      } else {
        expect([at, point.min, point.max]).toEqual([at, null, null]);
      }
      if (point.kind === 'enum') {
        const values = point.enumValues ?? [];
        expect([at, values.length > 0, new Set(values).size]).toEqual([at, true, values.length]);
      } else {
        expect([at, point.enumValues]).toEqual([at, null]);
      }
    }
  });

  it('ranks the headline points 1 then 2, each once, and every class has a first', () => {
    for (const { code, points } of ASSET_CLASSES) {
      const ranks = points
        .map((point) => point.headline)
        .filter((rank): rank is 1 | 2 => rank !== null)
        .sort();
      // [1] or [1, 2]: no repeat, no gap, never more than two (`uq_telemetry_point_class_headline`).
      expect([code, ranks.length >= 1 && ranks.length <= 2]).toEqual([code, true]);
      expect([code, ranks.every((rank, index) => rank === index + 1)]).toEqual([code, true]);
    }
  });

  it('watches only a number or a boolean point of its own class', () => {
    for (const { assetClass, rule } of RULES) {
      const at = `${assetClass.code}: ${rule.name}`;
      const watched = assetClass.points.find((point) => point.key === rule.key);
      expect([at, watched !== undefined]).toEqual([at, true]);
      expect([at, ['number', 'boolean'].includes(watched!.kind)]).toEqual([at, true]);
    }
  });

  it('keeps clear on the safe side of limit, and both inside the range of the point', () => {
    for (const { assetClass, rule } of RULES) {
      const at = `${assetClass.code}: ${rule.name}`;
      const safe =
        rule.comparator === 'above' ? rule.clear <= rule.limit : rule.clear >= rule.limit;
      expect([at, safe]).toEqual([at, true]);
      expect([at, rule.forS >= 0]).toEqual([at, true]);

      const point = assetClass.points.find((candidate) => candidate.key === rule.key)!;
      if (point.kind === 'boolean') {
        // Booleans compare as 1 and 0: "true" is `above 0.5`, "false" is `below 0.5`, `clear` equal.
        expect([at, rule.limit, rule.clear]).toEqual([at, 0.5, 0.5]);
      } else {
        for (const value of [rule.limit, rule.clear]) {
          expect([at, point.min! <= value && (point.max === null || value <= point.max)]).toEqual([
            at,
            true,
          ]);
        }
      }
    }
  });

  it('raises only facilities incidents', () => {
    // ADR-0021 lets a rule raise a `facilities` or an `environment` type; the seed uses the first.
    for (const { assetClass, rule } of RULES) {
      const at = `${assetClass.code}: ${rule.name}`;
      expect([at, categoryOf(rule.incidentType)]).toEqual([at, 'facilities']);
    }
  });

  it('leaves out the rules the document rules out', () => {
    const watched = (code: string) =>
      ASSET_CLASSES.find((assetClass) => assetClass.code === code)!.rules.map((rule) => rule.key);
    // Indoor climate feeds the heat overlay only; a gas alarm is a fire-safety type telemetry may
    // not raise, so only the detector's fault is watched; the lift's points cannot tell an
    // entrapment from a car out of service; only the switchgear raises `power_outage`.
    expect(watched('indoor_climate')).toEqual([]);
    expect(watched('gas_detector')).toEqual(['sensorFault']);
    expect(RULES.filter(({ rule }) => rule.incidentType === 'power_outage')).toHaveLength(1);
    expect(
      RULES.filter(({ rule }) => rule.incidentType === 'power_outage').map(
        ({ assetClass }) => assetClass.code,
      ),
    ).toEqual(['switchgear']);
    expect(RULES.some(({ rule }) => rule.incidentType === 'lift_entrapment')).toBe(false);
  });

  it('carries the limits the design frames show', () => {
    const rule = (code: string, name: string) =>
      ASSET_CLASSES.find((assetClass) => assetClass.code === code)!.rules.find(
        (candidate) => candidate.name === name,
      );
    // Frames 04 and 10: the motor rule; frames 08 and 15: the generator and the leak sensor.
    expect(rule('cooling_tower', 'Motor over-temperature')).toMatchObject({
      key: 'motorTempC',
      comparator: 'above',
      limit: 85,
      clear: 80,
      forS: 60,
      severity: 'critical',
    });
    expect(rule('standby_generator', 'Low fuel')).toMatchObject({ limit: 25, clear: 30 });
    expect(rule('standby_generator', 'Low starter battery')).toMatchObject({
      limit: 24,
      clear: 25,
    });
    expect(rule('leak_sensor', 'Leak sensor battery low')).toMatchObject({ limit: 20, clear: 25 });
  });
});

describe('missingFromCatalogue', () => {
  it('finds nothing missing when every seed row is present', () => {
    expect(missingFromCatalogue(presentOf())).toEqual({ classes: [], points: [], rules: [] });
  });

  it('finds everything missing in an empty database', () => {
    const missing = missingFromCatalogue({
      classes: new Set(),
      points: new Set(),
      rules: new Set(),
    });
    expect(missing.classes).toHaveLength(16);
    expect(missing.points).toHaveLength(66);
    expect(missing.rules).toHaveLength(22);
  });

  it('takes the points and the rules of a missing class with it', () => {
    const present = presentOf();
    present.classes.delete('cooling_tower');
    // The points and rules are still listed: a class that is not there owns nothing.
    const missing = missingFromCatalogue(present);

    expect(missing.classes.map(codeOf)).toEqual(['cooling_tower']);
    expect(new Set(missing.points.map(({ assetClass }) => assetClass.code))).toEqual(
      new Set(['cooling_tower']),
    );
    expect(missing.points).toHaveLength(12);
    expect(missing.rules).toHaveLength(3);
  });

  it('finds a missing point, and a missing rule, of a class that exists', () => {
    const present = presentOf();
    present.points.delete(pointRef('ups', 'autonomyMin'));
    present.rules.delete(ruleRef('transformer', 'Winding over-temperature'));
    const missing = missingFromCatalogue(present);

    expect(missing.classes).toEqual([]);
    expect(missing.points.map(({ assetClass, point }) => [assetClass.code, point.key])).toEqual([
      ['ups', 'autonomyMin'],
    ]);
    expect(missing.rules.map(({ assetClass, rule }) => [assetClass.code, rule.name])).toEqual([
      ['transformer', 'Winding over-temperature'],
    ]);
  });

  it('does not let a row added by hand hide a seed row that is missing', () => {
    // A count would say 22 of 22: an operator added a rule and a point, and a seed rule is gone.
    const present = presentOf();
    present.rules.delete(ruleRef('cooling_tower', 'High vibration'));
    present.rules.add(ruleRef('cooling_tower', 'Bearing temperature'));
    present.points.add(pointRef('cooling_tower', 'bearingTempC'));
    const missing = missingFromCatalogue(present);

    expect(present.rules.size).toBe(22);
    expect(missing.rules.map(({ rule }) => rule.name)).toEqual(['High vibration']);
    expect(missing.points).toEqual([]);
  });

  it('tells the same key on two classes apart', () => {
    // `running` is a point of six classes: only the one that is gone is reported.
    const present = presentOf();
    present.points.delete(pointRef('precision_cooling', 'running'));
    const missing = missingFromCatalogue(present);

    expect(missing.points.map(({ assetClass, point }) => [assetClass.code, point.key])).toEqual([
      ['precision_cooling', 'running'],
    ]);
  });
});
