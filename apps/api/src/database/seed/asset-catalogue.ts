import type {
  AssetFootprint,
  IncidentSeverity,
  IncidentType,
  TelemetryComparator,
  TelemetryPointKind,
} from '@occ/contracts';

/**
 * Reference data for the equipment catalogue (ADR-0018): the asset classes, what each one measures
 * and when a reading is abnormal. Every value is copied from `docs/design/v2/asset-classes.md`,
 * which is the source; change the document and this file together.
 *
 * A top-up inserts what is absent and never rewrites a row that exists (ADR-0017), so editing a
 * value here reaches an empty database only. A volume that already has the row keeps its value,
 * which is also how an operator's threshold survives a restart.
 */

export interface PointSeed {
  key: string;
  label: string;
  unit: string | null;
  kind: TelemetryPointKind;
  /** The valid range of a `number` point; `null` is no bound. Always `null` for other kinds. */
  min: number | null;
  max: number | null;
  /** Set exactly when `kind` is `enum`. */
  enumValues: string[] | null;
  expectedIntervalS: number;
  headline: 1 | 2 | null;
}

/** A class rule: it applies to every asset of the class, and none is an override. */
export interface RuleSeed {
  name: string;
  /** The `key` of one of the class's points, a `number` or a `boolean`. */
  key: string;
  comparator: TelemetryComparator;
  limit: number;
  /** The hysteresis level, on the safe side of `limit`. */
  clear: number;
  forS: number;
  severity: IncidentSeverity;
  /** A `facilities` or `environment` type (ADR-0021). */
  incidentType: IncidentType;
}

export interface ClassSeed {
  /** Lower snake case: `cooling_tower`. */
  code: string;
  name: string;
  /** `null` in V2-05 for every class; V2-13 sets it for the modelled ones (asset-classes.md). */
  modelKey: string | null;
  footprintM: AssetFootprint;
  points: PointSeed[];
  rules: RuleSeed[];
}

interface PointOptions {
  key: string;
  label: string;
  /** Left out when the point has no unit. */
  unit?: string;
  /** `expected_interval_s`: a reading is stale after three of these (ADR-0019). */
  intervalS: number;
  /** Rank 1 or 2 among the class's points shown first; left out for the others. */
  headline?: 1 | 2;
}

const toPoint = (
  kind: TelemetryPointKind,
  { key, label, unit, intervalS, headline }: PointOptions,
  shape: Pick<PointSeed, 'min' | 'max' | 'enumValues'>,
): PointSeed => ({
  key,
  label,
  unit: unit ?? null,
  kind,
  ...shape,
  expectedIntervalS: intervalS,
  headline: headline ?? null,
});

// One constructor per kind, so a boolean cannot carry a range and an enum cannot lack its values:
// two of the database's CHECKs become type errors here instead of a failed boot.
const numberPoint = (options: PointOptions & { min: number; max: number | null }): PointSeed =>
  toPoint('number', options, { min: options.min, max: options.max, enumValues: null });

const booleanPoint = (options: PointOptions): PointSeed =>
  toPoint('boolean', options, { min: null, max: null, enumValues: null });

const enumPoint = (options: PointOptions & { values: [string, ...string[]] }): PointSeed =>
  toPoint('enum', options, { min: null, max: null, enumValues: options.values });

/** Booleans compare as 1 (true) and 0 (false): "true" is `above 0.5`, "false" is `below 0.5`. */
const BOOLEAN_LIMIT = 0.5;

/**
 * Append only, in the order of `asset-classes.md`. Each class's points and rules keep that
 * document's order. `indoor_climate` has no rule in V2.0: it feeds the heat overlay only.
 */
export const ASSET_CLASSES: ClassSeed[] = [
  {
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelKey: null,
    footprintM: { width: 4, depth: 4, height: 5 },
    points: [
      numberPoint({
        key: 'fanSpeedRpm',
        label: 'Fan speed',
        unit: 'rpm',
        min: 0,
        max: 1800,
        intervalS: 1,
        headline: 1,
      }),
      numberPoint({
        key: 'motorTempC',
        label: 'Motor temperature',
        unit: '°C',
        min: -20,
        max: 150,
        intervalS: 5,
        headline: 2,
      }),
      numberPoint({
        key: 'motorCurrentA',
        label: 'Motor current',
        unit: 'A',
        min: 0,
        max: 60,
        intervalS: 5,
      }),
      numberPoint({
        key: 'vibrationMms',
        label: 'Vibration',
        unit: 'mm/s',
        min: 0,
        max: 50,
        intervalS: 5,
      }),
      numberPoint({
        key: 'fanSetpointRpm',
        label: 'Fan set point',
        unit: 'rpm',
        min: 0,
        max: 1800,
        intervalS: 30,
      }),
      numberPoint({
        key: 'waterInTempC',
        label: 'Water in',
        unit: '°C',
        min: 0,
        max: 60,
        intervalS: 10,
      }),
      numberPoint({
        key: 'waterOutTempC',
        label: 'Water out',
        unit: '°C',
        min: 0,
        max: 60,
        intervalS: 10,
      }),
      numberPoint({
        key: 'pumpFlowM3h',
        label: 'Pump flow',
        unit: 'm³/h',
        min: 0,
        max: 200,
        intervalS: 5,
      }),
      numberPoint({
        key: 'valveOpenPct',
        label: 'Valve opening',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 5,
      }),
      enumPoint({
        key: 'switchState',
        label: 'Control switch',
        values: ['off', 'auto', 'hand'],
        intervalS: 30,
      }),
      booleanPoint({ key: 'running', label: 'Running', intervalS: 10 }),
      // No maximum: the counter only grows.
      numberPoint({
        key: 'runHoursH',
        label: 'Run hours',
        unit: 'h',
        min: 0,
        max: null,
        intervalS: 3600,
      }),
    ],
    rules: [
      {
        name: 'Motor over-temperature',
        key: 'motorTempC',
        comparator: 'above',
        limit: 85,
        clear: 80,
        forS: 60,
        severity: 'critical',
        incidentType: 'equipment_fault',
      },
      {
        name: 'High vibration',
        key: 'vibrationMms',
        comparator: 'above',
        limit: 7.1,
        clear: 5,
        forS: 120,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
      {
        name: 'Motor overcurrent',
        key: 'motorCurrentA',
        comparator: 'above',
        limit: 24,
        clear: 22,
        forS: 60,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'standby_generator',
    name: 'Standby generator',
    modelKey: null,
    footprintM: { width: 6, depth: 2.5, height: 3 },
    points: [
      numberPoint({
        key: 'fuelLevelPct',
        label: 'Fuel level',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 60,
        headline: 1,
      }),
      numberPoint({
        key: 'starterBatteryV',
        label: 'Starter battery',
        unit: 'V',
        min: 0,
        max: 32,
        intervalS: 60,
        headline: 2,
      }),
      numberPoint({
        key: 'coolantTempC',
        label: 'Coolant temperature',
        unit: '°C',
        min: -20,
        max: 130,
        intervalS: 10,
      }),
      numberPoint({
        key: 'engineSpeedRpm',
        label: 'Engine speed',
        unit: 'rpm',
        min: 0,
        max: 1800,
        intervalS: 2,
      }),
      numberPoint({
        key: 'alternatorKw',
        label: 'Alternator output',
        unit: 'kW',
        min: 0,
        max: 2000,
        intervalS: 5,
      }),
      numberPoint({
        key: 'mainsVoltageV',
        label: 'Mains supply',
        unit: 'V',
        min: 0,
        max: 500,
        intervalS: 10,
      }),
      enumPoint({
        key: 'transferSource',
        label: 'Transfer switch',
        values: ['mains', 'generator'],
        intervalS: 5,
      }),
      booleanPoint({ key: 'breakerClosed', label: 'Main breaker', intervalS: 5 }),
      enumPoint({
        key: 'controlMode',
        label: 'Control panel',
        values: ['off', 'manual', 'auto'],
        intervalS: 30,
      }),
      booleanPoint({ key: 'running', label: 'Running', intervalS: 5 }),
    ],
    rules: [
      {
        name: 'Low fuel',
        key: 'fuelLevelPct',
        comparator: 'below',
        limit: 25,
        clear: 30,
        forS: 300,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
      {
        name: 'Low starter battery',
        key: 'starterBatteryV',
        comparator: 'below',
        limit: 24,
        clear: 25,
        forS: 300,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
      {
        name: 'Coolant too cold to start',
        key: 'coolantTempC',
        comparator: 'below',
        limit: 30,
        clear: 35,
        forS: 600,
        severity: 'medium',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'ups',
    name: 'UPS',
    modelKey: null,
    footprintM: { width: 2, depth: 1, height: 2 },
    points: [
      numberPoint({
        key: 'loadPct',
        label: 'Load',
        unit: '%',
        min: 0,
        max: 150,
        intervalS: 5,
        headline: 1,
      }),
      numberPoint({
        key: 'autonomyMin',
        label: 'Autonomy',
        unit: 'min',
        min: 0,
        max: 600,
        intervalS: 30,
        headline: 2,
      }),
      enumPoint({
        key: 'powerSource',
        label: 'Power source',
        values: ['mains', 'battery', 'bypass'],
        intervalS: 5,
      }),
      numberPoint({
        key: 'inputVoltageV',
        label: 'Input voltage',
        unit: 'V',
        min: 0,
        max: 500,
        intervalS: 10,
      }),
      numberPoint({
        key: 'outputVoltageV',
        label: 'Output voltage',
        unit: 'V',
        min: 0,
        max: 500,
        intervalS: 10,
      }),
    ],
    rules: [
      {
        name: 'UPS overload',
        key: 'loadPct',
        comparator: 'above',
        limit: 90,
        clear: 80,
        forS: 300,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
      {
        name: 'Low battery autonomy',
        key: 'autonomyMin',
        comparator: 'below',
        limit: 10,
        clear: 15,
        forS: 30,
        severity: 'critical',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'ups_battery',
    name: 'UPS battery bank',
    modelKey: null,
    footprintM: { width: 3, depth: 0.8, height: 2 },
    points: [
      numberPoint({
        key: 'chargePct',
        label: 'Charge',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 60,
        headline: 1,
      }),
      numberPoint({
        key: 'roomTempC',
        label: 'Room temperature',
        unit: '°C',
        min: -10,
        max: 60,
        intervalS: 60,
        headline: 2,
      }),
      enumPoint({
        key: 'chargeMode',
        label: 'Charge mode',
        values: ['float', 'boost', 'discharging'],
        intervalS: 30,
      }),
    ],
    rules: [
      {
        name: 'Battery room too warm',
        key: 'roomTempC',
        comparator: 'above',
        limit: 30,
        clear: 27,
        forS: 600,
        severity: 'medium',
        incidentType: 'hvac_fault',
      },
    ],
  },
  {
    code: 'precision_cooling',
    name: 'Precision cooling',
    modelKey: null,
    footprintM: { width: 1.8, depth: 0.9, height: 2 },
    points: [
      numberPoint({
        key: 'supplyAirTempC',
        label: 'Supply air',
        unit: '°C',
        min: 0,
        max: 40,
        intervalS: 10,
        headline: 1,
      }),
      numberPoint({
        key: 'returnAirTempC',
        label: 'Return air',
        unit: '°C',
        min: 0,
        max: 50,
        intervalS: 10,
        headline: 2,
      }),
      numberPoint({
        key: 'humidityPct',
        label: 'Return humidity',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 30,
      }),
      booleanPoint({ key: 'running', label: 'Running', intervalS: 10 }),
    ],
    rules: [
      {
        name: 'High supply air',
        key: 'supplyAirTempC',
        comparator: 'above',
        limit: 27,
        clear: 25,
        forS: 300,
        severity: 'high',
        incidentType: 'hvac_fault',
      },
    ],
  },
  {
    code: 'transformer',
    name: 'Transformer',
    modelKey: null,
    footprintM: { width: 2.5, depth: 2, height: 2.5 },
    points: [
      numberPoint({
        key: 'loadPct',
        label: 'Load',
        unit: '%',
        min: 0,
        max: 150,
        intervalS: 10,
        headline: 1,
      }),
      numberPoint({
        key: 'windingTempC',
        label: 'Winding temperature',
        unit: '°C',
        min: 0,
        max: 200,
        intervalS: 30,
        headline: 2,
      }),
      numberPoint({
        key: 'oilTempC',
        label: 'Oil temperature',
        unit: '°C',
        min: 0,
        max: 150,
        intervalS: 30,
      }),
    ],
    rules: [
      {
        name: 'Transformer overload',
        key: 'loadPct',
        comparator: 'above',
        limit: 100,
        clear: 90,
        forS: 600,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
      {
        name: 'Winding over-temperature',
        key: 'windingTempC',
        comparator: 'above',
        limit: 120,
        clear: 110,
        forS: 300,
        severity: 'high',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'switchgear',
    name: 'Switchgear',
    modelKey: null,
    footprintM: { width: 6, depth: 1, height: 2.3 },
    points: [
      numberPoint({
        key: 'busVoltageKv',
        label: 'Bus voltage',
        unit: 'kV',
        min: 0,
        max: 40,
        intervalS: 10,
        headline: 1,
      }),
      numberPoint({
        key: 'currentA',
        label: 'Current',
        unit: 'A',
        min: 0,
        max: 3000,
        intervalS: 10,
        headline: 2,
      }),
      numberPoint({
        key: 'activePowerKw',
        label: 'Active power',
        unit: 'kW',
        min: 0,
        max: 20000,
        intervalS: 10,
      }),
      booleanPoint({ key: 'incomerClosed', label: 'Incomer', intervalS: 5 }),
    ],
    rules: [
      // The only detector of a power outage: the generator and the UPS see the same event, and a
      // rule on each would open three incidents for one outage (22 kV nominal, alarm at -10 %).
      {
        name: 'Bus undervoltage',
        key: 'busVoltageKv',
        comparator: 'below',
        limit: 19.8,
        clear: 20.9,
        forS: 10,
        severity: 'critical',
        incidentType: 'power_outage',
      },
    ],
  },
  {
    code: 'chiller',
    name: 'Chiller',
    modelKey: null,
    footprintM: { width: 6, depth: 2, height: 2.5 },
    points: [
      numberPoint({
        key: 'chilledWaterSupplyTempC',
        label: 'Chilled water supply',
        unit: '°C',
        min: 0,
        max: 20,
        intervalS: 10,
        headline: 1,
      }),
      booleanPoint({ key: 'running', label: 'Running', intervalS: 10, headline: 2 }),
      numberPoint({
        key: 'chilledWaterReturnTempC',
        label: 'Chilled water return',
        unit: '°C',
        min: 0,
        max: 25,
        intervalS: 10,
      }),
      numberPoint({
        key: 'loadPct',
        label: 'Load',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 30,
      }),
    ],
    rules: [
      {
        name: 'High chilled water supply',
        key: 'chilledWaterSupplyTempC',
        comparator: 'above',
        limit: 10,
        clear: 8,
        forS: 600,
        severity: 'high',
        incidentType: 'hvac_fault',
      },
    ],
  },
  {
    code: 'air_handler',
    name: 'Air handler',
    modelKey: null,
    footprintM: { width: 4, depth: 2, height: 2 },
    points: [
      // `indoorTempC` is shared with `indoor_climate`, so the heat overlay reads one key.
      numberPoint({
        key: 'indoorTempC',
        label: 'Zone temperature',
        unit: '°C',
        min: 0,
        max: 45,
        intervalS: 30,
        headline: 1,
      }),
      numberPoint({
        key: 'supplyAirTempC',
        label: 'Supply air',
        unit: '°C',
        min: 0,
        max: 40,
        intervalS: 30,
        headline: 2,
      }),
      numberPoint({
        key: 'fanSpeedPct',
        label: 'Fan speed',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 10,
      }),
      booleanPoint({ key: 'running', label: 'Running', intervalS: 10 }),
    ],
    rules: [
      {
        name: 'Zone too warm',
        key: 'indoorTempC',
        comparator: 'above',
        limit: 27,
        clear: 25,
        forS: 900,
        severity: 'medium',
        incidentType: 'hvac_fault',
      },
    ],
  },
  {
    code: 'booster_pump',
    name: 'Booster pump',
    modelKey: null,
    footprintM: { width: 1.2, depth: 0.8, height: 1.2 },
    points: [
      numberPoint({
        key: 'dischargePressureBar',
        label: 'Discharge pressure',
        unit: 'bar',
        min: 0,
        max: 16,
        intervalS: 5,
        headline: 1,
      }),
      booleanPoint({ key: 'running', label: 'Running', intervalS: 5, headline: 2 }),
    ],
    rules: [
      {
        name: 'Low discharge pressure',
        key: 'dischargePressureBar',
        comparator: 'below',
        limit: 2,
        clear: 2.5,
        forS: 120,
        severity: 'medium',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'lift',
    name: 'Lift',
    modelKey: null,
    footprintM: { width: 2, depth: 2, height: 3 },
    points: [
      numberPoint({
        key: 'carFloor',
        label: 'Car at',
        min: -5,
        max: 60,
        intervalS: 2,
        headline: 1,
      }),
      booleanPoint({ key: 'inService', label: 'In service', intervalS: 30, headline: 2 }),
      enumPoint({
        key: 'direction',
        label: 'Direction',
        values: ['up', 'down', 'idle'],
        intervalS: 2,
      }),
      enumPoint({
        key: 'doorState',
        label: 'Doors',
        values: ['closed', 'opening', 'open', 'closing'],
        intervalS: 2,
      }),
    ],
    // No entrapment rule: the points cannot tell a stuck car with people inside from a car that
    // is out of service, so entrapments stay reported by people or the lift's own alarm.
    rules: [
      {
        name: 'Lift out of service',
        key: 'inService',
        comparator: 'below',
        limit: BOOLEAN_LIMIT,
        clear: BOOLEAN_LIMIT,
        forS: 300,
        severity: 'medium',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'barrier_arm',
    name: 'Barrier arm',
    modelKey: null,
    footprintM: { width: 4, depth: 0.4, height: 1.2 },
    points: [
      enumPoint({
        key: 'armPosition',
        label: 'Arm',
        values: ['up', 'down', 'moving'],
        intervalS: 5,
        headline: 1,
      }),
      booleanPoint({ key: 'faultActive', label: 'Fault', intervalS: 30 }),
    ],
    rules: [
      {
        name: 'Barrier fault',
        key: 'faultActive',
        comparator: 'above',
        limit: BOOLEAN_LIMIT,
        clear: BOOLEAN_LIMIT,
        forS: 30,
        severity: 'low',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'fume_hood',
    name: 'Fume hood',
    modelKey: null,
    footprintM: { width: 1.8, depth: 0.9, height: 2.4 },
    points: [
      numberPoint({
        key: 'faceVelocityMs',
        label: 'Face velocity',
        unit: 'm/s',
        min: 0,
        max: 2,
        intervalS: 5,
        headline: 1,
      }),
      numberPoint({
        key: 'sashOpenPct',
        label: 'Sash opening',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 10,
        headline: 2,
      }),
      booleanPoint({ key: 'flowAlarm', label: 'Flow alarm', intervalS: 5 }),
    ],
    rules: [
      {
        name: 'Low face velocity',
        key: 'faceVelocityMs',
        comparator: 'below',
        limit: 0.4,
        clear: 0.45,
        forS: 60,
        severity: 'high',
        incidentType: 'hvac_fault',
      },
    ],
  },
  {
    code: 'gas_detector',
    name: 'Gas detector',
    modelKey: null,
    footprintM: { width: 1.4, depth: 1.4, height: 1.4 },
    points: [
      numberPoint({
        key: 'gasPpm',
        label: 'Gas concentration',
        unit: 'ppm',
        min: 0,
        max: 1000,
        intervalS: 5,
        headline: 1,
      }),
      booleanPoint({ key: 'sensorFault', label: 'Sensor fault', intervalS: 60 }),
    ],
    // No rule on `gasPpm`: a gas alarm is a `gas_leak`, a `fire_safety` type that telemetry rules
    // may not raise (ADR-0021). The gas detection panel keeps its own alarm path.
    rules: [
      {
        name: 'Gas detector fault',
        key: 'sensorFault',
        comparator: 'above',
        limit: BOOLEAN_LIMIT,
        clear: BOOLEAN_LIMIT,
        forS: 60,
        severity: 'medium',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'leak_sensor',
    name: 'Leak sensor',
    modelKey: null,
    footprintM: { width: 1.4, depth: 1.4, height: 1.4 },
    points: [
      booleanPoint({ key: 'leakDetected', label: 'Leak', intervalS: 300, headline: 1 }),
      numberPoint({
        key: 'batteryPct',
        label: 'Battery',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 3600,
        headline: 2,
      }),
    ],
    rules: [
      {
        name: 'Water leak',
        key: 'leakDetected',
        comparator: 'above',
        limit: BOOLEAN_LIMIT,
        clear: BOOLEAN_LIMIT,
        forS: 10,
        severity: 'medium',
        incidentType: 'water_leak',
      },
      {
        name: 'Leak sensor battery low',
        key: 'batteryPct',
        comparator: 'below',
        limit: 20,
        clear: 25,
        forS: 3600,
        severity: 'low',
        incidentType: 'equipment_fault',
      },
    ],
  },
  {
    code: 'indoor_climate',
    name: 'Indoor climate sensor',
    modelKey: null,
    footprintM: { width: 1.4, depth: 1.4, height: 1.4 },
    points: [
      numberPoint({
        key: 'indoorTempC',
        label: 'Temperature',
        unit: '°C',
        min: 0,
        max: 45,
        intervalS: 60,
        headline: 1,
      }),
      numberPoint({
        key: 'humidityPct',
        label: 'Humidity',
        unit: '%',
        min: 0,
        max: 100,
        intervalS: 60,
        headline: 2,
      }),
    ],
    rules: [],
  },
];

/**
 * What the database holds of the seed classes, as the three sets `missingFromCatalogue` reads.
 * Built by the caller from a read; this module does no I/O.
 */
export interface PresentCatalogue {
  /** `asset_class.code` of the seed classes that exist. */
  classes: ReadonlySet<string>;
  /** `pointRef` of every point of a seed class that exists. */
  points: ReadonlySet<string>;
  /** `ruleRef` of every class rule (no asset) of a seed class that exists. */
  rules: ReadonlySet<string>;
}

export interface MissingCatalogue {
  classes: ClassSeed[];
  points: { assetClass: ClassSeed; point: PointSeed }[];
  rules: { assetClass: ClassSeed; rule: RuleSeed }[];
}

// A class code and a point key contain no `:`, so the first one always splits a reference.
export const pointRef = (classCode: string, key: string): string => `${classCode}:${key}`;
export const ruleRef = (classCode: string, name: string): string => `${classCode}:${name}`;

/**
 * The seed rows `present` lacks. Written as a comparison of sets rather than a row count, so a
 * rule or a point added by hand cannot hide a seed one that is missing. The points and rules of a
 * missing class are missing whatever `present` says about them.
 */
export function missingFromCatalogue(present: PresentCatalogue): MissingCatalogue {
  const missing: MissingCatalogue = { classes: [], points: [], rules: [] };
  for (const assetClass of ASSET_CLASSES) {
    const classExists = present.classes.has(assetClass.code);
    if (!classExists) missing.classes.push(assetClass);
    for (const point of assetClass.points) {
      if (!classExists || !present.points.has(pointRef(assetClass.code, point.key))) {
        missing.points.push({ assetClass, point });
      }
    }
    for (const rule of assetClass.rules) {
      if (!classExists || !present.rules.has(ruleRef(assetClass.code, rule.name))) {
        missing.rules.push({ assetClass, rule });
      }
    }
  }
  return missing;
}
