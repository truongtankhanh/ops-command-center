import { describe, expect, it } from 'vitest';
import { dueReadings, type SimAsset } from './schedule';
import { valueAt } from './waveform';

const asset: SimAsset = {
  code: 'CT-01',
  classCode: 'cooling_tower',
  rules: [{ key: 'motorTempC', comparator: 'above', limit: 85, clear: 80 }],
  points: [
    {
      key: 'motorTempC',
      kind: 'number',
      min: -20,
      max: 150,
      enumValues: null,
      expectedIntervalS: 5,
    },
    {
      key: 'running',
      kind: 'boolean',
      min: null,
      max: null,
      enumValues: null,
      expectedIntervalS: 5,
    },
    {
      key: 'fanSpeedRpm',
      kind: 'number',
      min: 0,
      max: 1800,
      enumValues: null,
      expectedIntervalS: 1,
    },
  ],
};

// 08:00:07.500 UTC: the 5 s points last fell due at :05, the 1 s point at :07.
const NOW = Date.UTC(2026, 9, 14, 8, 0, 7, 500);
const AT_05 = Date.UTC(2026, 9, 14, 8, 0, 5);
const AT_07 = Date.UTC(2026, 9, 14, 8, 0, 7);

describe('dueReadings', () => {
  it('emits each point once at the boundary of its own interval, grouped by boundary', () => {
    const readings = dueReadings(asset, NOW, new Map());

    expect(readings.map((reading) => reading.at).sort()).toEqual([
      new Date(AT_05).toISOString(),
      new Date(AT_07).toISOString(),
    ]);
    const five = readings.find((reading) => reading.at === new Date(AT_05).toISOString());
    expect(Object.keys(five?.values ?? {}).sort()).toEqual(['motorTempC', 'running']);
    const one = readings.find((reading) => reading.at === new Date(AT_07).toISOString());
    expect(Object.keys(one?.values ?? {})).toEqual(['fanSpeedRpm']);
  });

  it("uses the mock source's values: the waveform at the boundary, not at the wall clock", () => {
    const [reading] = dueReadings({ ...asset, points: [asset.points[0]!] }, NOW, new Map());

    expect(reading?.values.motorTempC).toBe(valueAt('CT-01', asset.points[0]!, asset.rules, AT_05));
  });

  it('emits nothing again inside the same boundary, and the new boundary when it passes', () => {
    const last = new Map<string, number>();
    dueReadings(asset, NOW, last);

    expect(dueReadings(asset, NOW + 400, last)).toEqual([]);

    const next = dueReadings(asset, NOW + 1000, last);
    expect(next).toHaveLength(1);
    expect(next[0]?.at).toBe(new Date(AT_07 + 1000).toISOString());
    expect(Object.keys(next[0]?.values ?? {})).toEqual(['fanSpeedRpm']);
  });

  it('emits the latest boundary only when a tick finds several behind', () => {
    const last = new Map<string, number>([['CT-01/fanSpeedRpm', AT_07 - 10_000]]);

    const readings = dueReadings({ ...asset, points: [asset.points[2]!] }, NOW, last);

    expect(readings).toHaveLength(1);
    expect(readings[0]?.at).toBe(new Date(AT_07).toISOString());
  });

  it('leaves out a point the waveform has no value for', () => {
    const broken: SimAsset = {
      ...asset,
      points: [
        { key: 'mode', kind: 'enum', min: null, max: null, enumValues: null, expectedIntervalS: 5 },
      ],
    };

    expect(dueReadings(broken, NOW, new Map())).toEqual([]);
  });

  it('keeps its state per asset and key', () => {
    const last = new Map<string, number>();
    dueReadings(asset, NOW, last);

    expect([...last.keys()].sort()).toEqual([
      'CT-01/fanSpeedRpm',
      'CT-01/motorTempC',
      'CT-01/running',
    ]);
  });
});
