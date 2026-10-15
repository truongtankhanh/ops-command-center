import type { Asset, TelemetryPoint, TelemetryValue } from '@occ/contracts';
import { formatReading, limitLine, statePointOf } from './readings';

type PointShape = Pick<TelemetryPoint, 'key' | 'kind' | 'unit'>;

const num = (key: string, unit: string | null): PointShape => ({ key, kind: 'number', unit });
const bool = (key: string): PointShape => ({ key, kind: 'boolean', unit: null });
const enumPoint = (key: string): PointShape => ({ key, kind: 'enum', unit: null });

describe('formatReading', () => {
  // The values of frames 02 and 03.
  it.each<[string, PointShape, TelemetryValue, string]>([
    ['a number with a thousands separator', num('fanSpeedRpm', 'rpm'), 1420, '1,420 rpm'],
    ['a temperature', num('motorTempC', '°C'), 71, '71 °C'],
    ['a current', num('motorCurrentA', 'A'), 18.6, '18.6 A'],
    ['a velocity', num('vibrationMmS', 'm/s'), 0.5, '0.5 m/s'],
    ['a percentage keeps its space', num('fuelLevelPct', '%'), 86, '86 %'],
    ['at most one fraction digit', num('fanSpeedRpm', 'rpm'), 1234.56, '1,234.6 rpm'],
    ['a number with no unit', num('runHours', null), 12, '12'],
    ['an empty unit is no unit', num('runHours', ''), 12, '12'],
    ['a tiny negative is not "-0"', num('motorTempC', '°C'), -0.04, '0 °C'],
    ['zero', num('fanSpeedRpm', 'rpm'), 0, '0 rpm'],
  ])('%s', (_name, point, value, expected) => {
    expect(formatReading(point, value)).toBe(expected);
  });

  describe('the words of a key', () => {
    it.each<[string, PointShape, TelemetryValue, string]>([
      ['leak, wet', bool('leakDetected'), true, 'Wet'],
      ['leak, dry', bool('leakDetected'), false, 'Dry'],
      ['in service', bool('inService'), true, 'In service'],
      ['out of service', bool('inService'), false, 'Out of service'],
      ['running', bool('running'), true, 'Running'],
      ['stopped', bool('running'), false, 'Stopped'],
      ['arm up', enumPoint('armPosition'), 'up', 'Up'],
      ['arm down', enumPoint('armPosition'), 'down', 'Down'],
      ['arm moving', enumPoint('armPosition'), 'moving', 'Moving'],
      ['breaker closed', bool('breakerClosed'), true, 'Closed'],
      ['breaker open', bool('breakerClosed'), false, 'Open'],
      ['a car floor', num('carFloor', null), 2, 'Floor 2'],
      ['a basement floor', num('carFloor', null), -1, 'Floor -1'],
    ])('%s', (_name, point, value, expected) => {
      expect(formatReading(point, value)).toBe(expected);
    });

    it('does not read a word off the object prototype', () => {
      expect(formatReading(bool('constructor'), true)).toBe('Yes');
    });
  });

  describe('a key with no word entry', () => {
    it('reads a boolean as Yes / No', () => {
      expect(formatReading(bool('interlockClosed'), true)).toBe('Yes');
      expect(formatReading(bool('interlockClosed'), false)).toBe('No');
    });

    it('reads an enum value in sentence case', () => {
      expect(formatReading(enumPoint('controlMode'), 'auto')).toBe('Auto');
      expect(formatReading(enumPoint('transferSource'), 'mains')).toBe('Mains');
    });

    it('does not fail on an empty enum value', () => {
      expect(formatReading(enumPoint('controlMode'), '')).toBe('');
    });
  });

  describe('a value the API sent that this console did not expect', () => {
    it('draws a value of the wrong type as it came', () => {
      expect(formatReading(num('motorTempC', '°C'), 'hot')).toBe('hot');
      expect(formatReading(bool('breakerClosed'), 1)).toBe('1');
      expect(formatReading(enumPoint('controlMode'), 3)).toBe('3');
    });

    it('draws a number that is not finite without a unit', () => {
      expect(formatReading(num('motorTempC', '°C'), Number.NaN)).toBe('NaN');
    });

    it('falls back to the raw value for a kind from a newer API', () => {
      const future = { key: 'x', kind: 'vector', unit: null } as unknown as PointShape;
      expect(formatReading(future, 'a')).toBe('a');
    });

    it('sentence-cases an enum value its word table does not know', () => {
      expect(formatReading(enumPoint('armPosition'), 'jammed')).toBe('Jammed');
    });

    it('draws a word-table key whose value has the wrong type by its kind', () => {
      expect(formatReading(bool('leakDetected'), 'wet')).toBe('wet');
    });
  });
});

describe('limitLine', () => {
  it('reads an upper limit as "Limit"', () => {
    expect(limitLine({ comparator: 'above', limit: 85 }, num('motorTempC', '°C'))).toBe(
      'Limit 85 °C',
    );
    expect(limitLine({ comparator: 'above', limit: 7.1 }, num('vibrationMmS', 'mm/s'))).toBe(
      'Limit 7.1 mm/s',
    );
  });

  it('reads a lower limit as "Low at" (frame 08)', () => {
    expect(limitLine({ comparator: 'below', limit: 25 }, num('fuelLevelPct', '%'))).toBe(
      'Low at 25 %',
    );
  });

  it('formats the limit like a reading', () => {
    expect(limitLine({ comparator: 'above', limit: 1500 }, num('fanSpeedRpm', 'rpm'))).toBe(
      'Limit 1,500 rpm',
    );
  });

  it('has no line for a boolean point: its 0.5 is an encoding', () => {
    expect(limitLine({ comparator: 'above', limit: 0.5 }, bool('leakDetected'))).toBeNull();
  });

  it('has no line for a comparator it does not know', () => {
    const future = { comparator: 'between', limit: 1 } as unknown as Parameters<
      typeof limitLine
    >[0];
    expect(limitLine(future, num('motorTempC', '°C'))).toBeNull();
  });
});

describe('statePointOf', () => {
  const headlineOf = (...keys: string[]): TelemetryPoint[] =>
    keys.map((key, index) => ({
      key,
      label: key,
      unit: null,
      kind: 'number',
      min: null,
      max: null,
      enumValues: null,
      expectedIntervalS: 1,
      headline: index === 0 ? 1 : 2,
    }));

  const asset = (classCode: string, ...headline: string[]): Pick<Asset, 'class' | 'headline'> => ({
    class: {
      id: classCode,
      code: classCode,
      name: classCode,
      modelUrl: null,
      footprintM: { width: 1, depth: 1, height: 1 },
    },
    headline: headlineOf(...headline),
  });

  it.each([
    'cooling_tower',
    'standby_generator',
    'precision_cooling',
    'chiller',
    'air_handler',
    'booster_pump',
  ])('is `running` for %s, whatever its headline', (classCode) => {
    expect(statePointOf(asset(classCode, 'fanSpeedRpm', 'motorTempC'))).toBe('running');
  });

  it('is `armPosition` for a barrier arm', () => {
    expect(statePointOf(asset('barrier_arm', 'armPosition'))).toBe('armPosition');
  });

  it.each([
    'ups',
    'ups_battery',
    'transformer',
    'switchgear',
    'lift',
    'fume_hood',
    'gas_detector',
    'leak_sensor',
    'indoor_climate',
  ])('is none for %s', (classCode) => {
    expect(statePointOf(asset(classCode, 'leakDetected'))).toBeNull();
  });

  it('takes a headline point that is a state point before the table', () => {
    expect(statePointOf(asset('some_new_class', 'temperatureC', 'running'))).toBe('running');
  });

  it('is none for a class this console does not know', () => {
    expect(statePointOf(asset('hovercraft', 'speed'))).toBeNull();
  });

  it('does not read a class off the object prototype', () => {
    expect(statePointOf(asset('constructor'))).toBeNull();
  });
});
