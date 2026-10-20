import type { Asset, Incident, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import { twinColors } from '../styles/tokens';
import type { AssetTelemetryState } from './telemetryState';
import {
  buildingReadings,
  HEAT_DOMAIN,
  type HeatReading,
  heatColor,
  heatLabel,
  heatSceneOf,
  heatT,
  showsHeat,
  tempText,
} from './twinHeat';

const NOW = Date.parse('2026-10-20T08:00:00.000Z');

const point = (key: string, expectedIntervalS: number): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS,
  headline: 1,
});

const asset = (code: string, zoneId: string, overrides: Partial<Asset> = {}): Asset => ({
  id: `asset-${code}`,
  code,
  name: code,
  class: {
    id: 'class-ups',
    code: 'ups',
    name: 'UPS',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId,
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point('loadPct', 5)],
  ...overrides,
});

/** An indoor climate sensor: a 60 s point, so a reading is stale from 180 s. */
const sensor = (code: string, zoneId: string): Asset =>
  asset(code, zoneId, { headline: [point('indoorTempC', 60), point('humidityPct', 60)] });

/** An air handler: a 30 s point, so a reading is stale from 90 s. */
const handler = (code: string, zoneId: string): Asset =>
  asset(code, zoneId, {
    class: { ...asset('x', zoneId).class, code: 'air_handler' },
    headline: [point('indoorTempC', 30), point('supplyAirTempC', 60)],
  });

const zone = (id: string, kind: Zone['kind'] = 'building'): Pick<Zone, 'id' | 'kind'> => ({
  id,
  kind,
});

/** What the console holds of an asset: received `ageMs` before `NOW`. */
const entry = ({
  online = true,
  ageMs = 1_000,
  values = {},
}: {
  online?: boolean;
  ageMs?: number;
  values?: Record<string, TelemetryValue>;
} = {}): AssetTelemetryState => ({
  online,
  receivedAt: new Date(NOW - ageMs).toISOString(),
  headline: values,
  values,
  keyReceivedAt: {},
});

const reads = (tempC: number): AssetTelemetryState => entry({ values: { indoorTempC: tempC } });

const DC = zone('zone-dc');

/** The reading of the one building `zone-dc`, given its assets and what the console holds of them. */
function readingOf(
  assets: Asset[],
  overview: Record<string, AssetTelemetryState>,
  now: number | null = NOW,
): HeatReading | undefined {
  return buildingReadings([DC], assets, overview, now).get('zone-dc');
}

describe('buildingReadings', () => {
  it('reads a building`s one fresh source', () => {
    const reading = readingOf([sensor('ICS-DC', 'zone-dc')], { 'ICS-DC': reads(22.1) });

    expect(reading).toEqual({ tempC: 22.1, sources: ['ICS-DC'] });
  });

  it('averages two sources: the middle of the ramp', () => {
    const assets = [sensor('ICS-A', 'zone-dc'), handler('AHU-A', 'zone-dc')];
    const overview = { 'ICS-A': reads(22), 'AHU-A': reads(24) };

    const reading = readingOf(assets, overview);

    expect(reading).toEqual({ tempC: 23, sources: ['AHU-A', 'ICS-A'] });
    expect(heatT(23)).toBeCloseTo(0.5, 10);
  });

  it('lists the sources by code, whatever the catalogue`s order', () => {
    const overview = { 'ICS-B': reads(21), 'AHU-A': reads(23), 'ICS-C': reads(25) };
    const assets = [
      sensor('ICS-C', 'zone-dc'),
      sensor('ICS-B', 'zone-dc'),
      handler('AHU-A', 'zone-dc'),
    ];

    expect(readingOf(assets, overview)).toEqual({
      tempC: 23,
      sources: ['AHU-A', 'ICS-B', 'ICS-C'],
    });
  });

  it('does not count a stale source: the fresh one reads alone', () => {
    const assets = [sensor('ICS-A', 'zone-dc'), sensor('ICS-B', 'zone-dc')];
    const overview = {
      'ICS-A': entry({ ageMs: 180_000, values: { indoorTempC: 21 } }),
      'ICS-B': reads(25),
    };

    expect(readingOf(assets, overview)).toEqual({ tempC: 25, sources: ['ICS-B'] });
  });

  it('is silent when its only source is stale', () => {
    const overview = { 'ICS-SEC': entry({ ageMs: 180_000, values: { indoorTempC: 22 } }) };

    expect(readingOf([sensor('ICS-SEC', 'zone-dc')], overview)).toBe('silent');
  });

  it('judges each source by its own class: 90 s for an air handler, 180 s for a sensor', () => {
    const at = (ageMs: number) => entry({ ageMs, values: { indoorTempC: 22 } });

    expect(readingOf([handler('AHU-A', 'zone-dc')], { 'AHU-A': at(89_999) })).not.toBe('silent');
    expect(readingOf([handler('AHU-A', 'zone-dc')], { 'AHU-A': at(90_000) })).toBe('silent');
    expect(readingOf([sensor('ICS-A', 'zone-dc')], { 'ICS-A': at(179_999) })).not.toBe('silent');
    expect(readingOf([sensor('ICS-A', 'zone-dc')], { 'ICS-A': at(180_000) })).toBe('silent');
  });

  it('is silent when its only source is offline', () => {
    const overview = { 'ICS-A': entry({ online: false, values: { indoorTempC: 22 } }) };

    expect(readingOf([sensor('ICS-A', 'zone-dc')], overview)).toBe('silent');
  });

  it('is silent when the console holds nothing of the source yet', () => {
    expect(readingOf([sensor('ICS-A', 'zone-dc')], {})).toBe('silent');
  });

  it('is silent for a building with no source at all', () => {
    const assets = [asset('UPS-01', 'zone-dc'), asset('CT-01', 'zone-dc')];
    const overview = { 'UPS-01': entry(), 'CT-01': entry() };

    expect(readingOf(assets, overview)).toBe('silent');
  });

  it('is silent for a building with no asset', () => {
    expect(readingOf([], {})).toBe('silent');
  });

  it('does not count a source with no value yet or a value that is not a finite number', () => {
    const assets = [
      sensor('ICS-A', 'zone-dc'),
      sensor('ICS-B', 'zone-dc'),
      sensor('ICS-C', 'zone-dc'),
      sensor('ICS-D', 'zone-dc'),
      sensor('ICS-E', 'zone-dc'),
    ];
    const overview = {
      'ICS-A': entry(),
      'ICS-B': entry({ values: { indoorTempC: 'n/a' } }),
      'ICS-C': reads(Number.NaN),
      'ICS-D': reads(Number.POSITIVE_INFINITY),
      'ICS-E': reads(22),
    };

    expect(readingOf(assets, overview)).toEqual({ tempC: 22, sources: ['ICS-E'] });
  });

  it('is silent when no source has a usable value, never NaN', () => {
    const overview = { 'ICS-A': reads(Number.NaN) };

    expect(readingOf([sensor('ICS-A', 'zone-dc')], overview)).toBe('silent');
  });

  it('counts a source in fault: a reading is a reading', () => {
    // `buildingReadings` takes no incidents, so a fault cannot hide a fresh reading.
    expect(readingOf([sensor('ICS-A', 'zone-dc')], { 'ICS-A': reads(26) })).toEqual({
      tempC: 26,
      sources: ['ICS-A'],
    });
  });

  it('cannot judge without a server clock, so a reading is not stale', () => {
    const overview = { 'ICS-A': entry({ ageMs: 3_600_000, values: { indoorTempC: 22.1 } }) };

    expect(readingOf([sensor('ICS-A', 'zone-dc')], overview, null)).toEqual({
      tempC: 22.1,
      sources: ['ICS-A'],
    });
  });

  it('still leaves out an offline source without a clock', () => {
    const overview = { 'ICS-A': entry({ online: false, values: { indoorTempC: 22 } }) };

    expect(readingOf([sensor('ICS-A', 'zone-dc')], overview, null)).toBe('silent');
  });

  it('reads the point, not the class: a roof air handler counts, a class with the point counts', () => {
    const roof = handler('AHU-ROOF', 'zone-dc');
    const unknownClass = asset('NEW-01', 'zone-dc', {
      class: { ...asset('x', 'zone-dc').class, code: 'a_class_added_later' },
      headline: [point('indoorTempC', 60)],
    });
    const overview = { 'AHU-ROOF': reads(22), 'NEW-01': reads(24) };

    expect(readingOf([roof, unknownClass], overview)).toEqual({
      tempC: 23,
      sources: ['AHU-ROOF', 'NEW-01'],
    });
  });

  it('reads only the sources of the building: another zone`s sensor does not count', () => {
    const assets = [sensor('ICS-DC', 'zone-dc'), sensor('ICS-HUB', 'zone-hub')];
    const overview = { 'ICS-DC': reads(22), 'ICS-HUB': reads(26) };

    expect(readingOf(assets, overview)).toEqual({ tempC: 22, sources: ['ICS-DC'] });
  });

  it('has an entry per building and none for a zone that is not a building', () => {
    const zones = [zone('zone-dc'), zone('zone-car-park', 'parking'), zone('zone-hub')];
    const assets = [sensor('ICS-DC', 'zone-dc'), sensor('ICS-CP', 'zone-car-park')];
    const overview = { 'ICS-DC': reads(22), 'ICS-CP': reads(30) };

    const readings = buildingReadings(zones, assets, overview, NOW);

    expect([...readings.keys()]).toEqual(['zone-dc', 'zone-hub']);
    expect(readings.get('zone-hub')).toBe('silent');
    expect(readings.get('zone-car-park')).toBeUndefined();
  });

  it('is empty for no zone', () => {
    expect(buildingReadings([], [sensor('ICS-DC', 'zone-dc')], {}, NOW).size).toBe(0);
  });

  it('takes the mean of the raw values, rounded only for the label', () => {
    const assets = [sensor('ICS-A', 'zone-dc'), sensor('ICS-B', 'zone-dc')];
    const overview = { 'ICS-A': reads(22.14), 'ICS-B': reads(22.16) };

    const reading = readingOf(assets, overview);

    expect(reading).not.toBe('silent');
    expect(reading).toMatchObject({ tempC: expect.closeTo(22.15, 10) as number });
  });

  it('does not change what it is given', () => {
    const assets = [sensor('ICS-B', 'zone-dc'), sensor('ICS-A', 'zone-dc')];
    const overview = { 'ICS-A': reads(21), 'ICS-B': reads(23) };
    const zones = [DC];

    buildingReadings(zones, assets, overview, NOW);

    expect(assets.map((a) => a.code)).toEqual(['ICS-B', 'ICS-A']);
    expect(zones).toEqual([DC]);
  });
});

/** Frame 13's buildings: the mean its sensor reads, the `heat` value and the label the mockup draws. */
const FRAME_13: [name: string, tempC: number, t: number, label: string][] = [
  ['InnovationHub', 22.0, 0.375, '22.0 °C'],
  ['Library', 21.4, 0.3, '21.4 °C'],
  ['LectureHallA', 23.6, 0.575, '23.6 °C'],
  ['DataCenter', 22.1, 0.388, '22.1 °C'],
  ['StudentCenter', 24.8, 0.725, '24.8 °C'],
  ['SportsHall', 25.9, 0.862, '25.9 °C'],
  ['AdminBuilding', 22.6, 0.45, '22.6 °C'],
  ['ScienceLab', 21.0, 0.25, '21.0 °C'],
  ['DormitoryA', 24.1, 0.638, '24.1 °C'],
  ['DormitoryB', 26.4, 0.925, '26.4 °C'],
  ['HealthClinic', 22.5, 0.438, '22.5 °C'],
];

describe('frame 13', () => {
  const zones = [...FRAME_13.map(([name]) => zone(name)), zone('SecurityOffice')];
  const assets = [
    ...FRAME_13.map(([name]) => sensor(`ICS-${name}`, name)),
    sensor('ICS-SEC', 'SecurityOffice'),
  ];
  const overview = {
    ...Object.fromEntries(FRAME_13.map(([name, tempC]) => [`ICS-${name}`, reads(tempC)])),
    'ICS-SEC': entry({ ageMs: 180_000, values: { indoorTempC: 22 } }),
  };
  const readings = buildingReadings(zones, assets, overview, NOW);

  it.each(FRAME_13)('%s reads %s °C: t %s and the label %s', (name, tempC, t, label) => {
    const reading = readings.get(name);

    expect(reading).toEqual({ tempC, sources: [`ICS-${name}`] });
    // The mockup writes `t` to three decimals (and some of them cut a half), so compare to two.
    expect(heatT(tempC)).toBeCloseTo(t, 2);
    expect(heatLabel(reading as HeatReading)).toBe(label);
  });

  it('reproduces the two values the task names: 22.0 °C is 0.375 and 26.4 °C is 0.925', () => {
    expect(heatT(22.0)).toBeCloseTo(0.375, 10);
    expect(heatT(26.4)).toBeCloseTo(0.925, 10);
  });

  it('makes the building whose sensor is stale silent: "No data"', () => {
    const reading = readings.get('SecurityOffice');

    expect(reading).toBe('silent');
    expect(heatLabel(reading as HeatReading)).toBe('No data');
  });

  it('reads the real number in the label also beyond the scale, while the colour clamps', () => {
    const hot = { tempC: 29.3, sources: ['ICS-A'] };
    const cold = { tempC: 17.04, sources: ['ICS-A'] };

    expect(heatLabel(hot)).toBe('29.3 °C');
    expect(heatT(hot.tempC)).toBe(1);
    expect(heatLabel(cold)).toBe('17.0 °C');
    expect(heatT(cold.tempC)).toBe(0);
  });
});

describe('heatT', () => {
  it('puts the scale`s ends at 0 and 1: 19 °C and 27 °C', () => {
    expect(HEAT_DOMAIN).toEqual([19, 27]);
    expect(heatT(19)).toBe(0);
    expect(heatT(27)).toBe(1);
    expect(heatT(23)).toBeCloseTo(0.5, 10);
  });

  it('holds a temperature beyond the scale to 0 and 1', () => {
    expect(heatT(-40)).toBe(0);
    expect(heatT(18.99)).toBe(0);
    expect(heatT(27.01)).toBe(1);
    expect(heatT(120)).toBe(1);
  });

  it('takes another domain', () => {
    expect(heatT(15, [10, 20])).toBeCloseTo(0.5, 10);
    expect(heatT(5, [10, 20])).toBe(0);
    expect(heatT(25, [10, 20])).toBe(1);
  });

  it('is never NaN: a temperature that is not finite gives 0', () => {
    expect(heatT(Number.NaN)).toBe(0);
    expect(heatT(Number.POSITIVE_INFINITY)).toBe(0);
    expect(heatT(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('is never NaN: an empty or reversed domain gives 0', () => {
    expect(heatT(22, [20, 20])).toBe(0);
    expect(heatT(22, [27, 19])).toBe(0);
    expect(heatT(22, [Number.NaN, 27])).toBe(0);
  });
});

describe('heatColor', () => {
  const stops = twinColors.heat;

  it('is a stop`s own colour exactly at the stop', () => {
    stops.forEach((stop, index) => {
      expect(heatColor(index / (stops.length - 1), stops)).toBe(stop);
    });
  });

  it('holds t to 0 – 1: the ends beyond', () => {
    expect(heatColor(-1, stops)).toBe(stops[0]);
    expect(heatColor(2, stops)).toBe(stops[stops.length - 1]);
  });

  it('mixes the neighbours in sRGB, rounded per channel', () => {
    expect(heatColor(0.5, ['#000000', '#ffffff'])).toBe('#808080');
    expect(heatColor(0.25, ['#000000', '#ffffff'])).toBe('#404040');
  });

  it('mixes between the right pair of stops', () => {
    // x = 1.5: halfway from the second stop to the third.
    expect(heatColor(0.75, ['#000000', '#ffffff', '#000000'])).toBe('#808080');
    expect(heatColor(0.5, ['#000000', '#ffffff', '#000000'])).toBe('#ffffff');
  });

  it('is continuous between the legend`s stops: neither neighbour`s colour', () => {
    const colour = heatColor(0.375, stops);

    expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(stops).not.toContain(colour);
  });

  it('rises in lightness with t: lightness carries the value', () => {
    const sum = (hex: string) =>
      [1, 3, 5].reduce((total, at) => total + Number.parseInt(hex.slice(at, at + 2), 16), 0);
    let previous = -1;

    for (let step = 0; step <= 20; step += 1) {
      const lightness = sum(heatColor(step / 20, stops));
      expect(lightness).toBeGreaterThanOrEqual(previous);
      previous = lightness;
    }
  });

  it('treats a t that is not a number as 0', () => {
    expect(heatColor(Number.NaN, stops)).toBe(stops[0]);
  });

  it('cannot interpolate fewer than two stops: the first one, or black for none', () => {
    expect(heatColor(0.7, ['#123456'])).toBe('#123456');
    expect(heatColor(0.7, [])).toBe('#000000');
  });
});

describe('tempText', () => {
  it('shows one decimal and the unit', () => {
    expect(tempText(22.1)).toBe('22.1 °C');
    expect(tempText(22)).toBe('22.0 °C');
    expect(tempText(22.14)).toBe('22.1 °C');
    expect(tempText(22.16)).toBe('22.2 °C');
  });

  it('shows a temperature below zero', () => {
    expect(tempText(-3.25)).toBe('-3.3 °C');
  });
});

describe('heatLabel', () => {
  it('is the temperature of a building with a reading', () => {
    expect(heatLabel({ tempC: 23, sources: ['ICS-A', 'ICS-B'] })).toBe('23.0 °C');
  });

  it('is "No data" for a silent building: the Assets tab`s word', () => {
    expect(heatLabel('silent')).toBe('No data');
  });
});

describe('showsHeat', () => {
  it('shows the overlay at campus and building level', () => {
    expect(showsHeat('campus')).toBe(true);
    expect(showsHeat('building')).toBe(true);
  });

  it('draws nothing different with an asset isolated, or one of its parts', () => {
    expect(showsHeat('asset')).toBe(false);
    expect(showsHeat('part')).toBe(false);
  });
});

describe('heatSceneOf', () => {
  const stops = twinColors.heat;
  const ZONES = [
    { id: 'zone-b', name: 'Beta Hall' },
    { id: 'zone-a', name: 'Alpha Hub' },
    { id: 'zone-c', name: 'Gamma Lab' },
  ];
  const ASSETS = [
    sensor('ICS-A', 'zone-a'),
    sensor('ICS-B', 'zone-b'),
    sensor('ICS-C', 'zone-c'),
    asset('GEN-01', 'zone-a'),
    asset('UPS-01', 'zone-a'),
  ];

  const incident = (overrides: Partial<Incident> = {}): Incident => ({
    id: 'inc-1',
    code: 'INC-000105',
    type: 'equipment_fault',
    severity: 'high',
    status: 'open',
    title: 'Fault',
    description: null,
    zoneId: 'zone-a',
    position: [108.44, 11.95],
    source: 'telemetry',
    assetId: 'asset-GEN-01',
    reportedAt: '2026-10-20T07:50:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  });

  /** The scene of the three buildings, `ICS-C` silent unless the overview says otherwise. */
  function sceneOf(
    overrides: Record<string, AssetTelemetryState> = {},
    incidents: Incident[] = [],
  ) {
    const overview = { 'ICS-A': reads(22), 'ICS-B': reads(26.4), ...overrides };
    const zones = ZONES.map(({ id }) => zone(id));
    const readings = buildingReadings(zones, ASSETS, overview, NOW);
    return heatSceneOf({ zones: ZONES, readings, assets: ASSETS, incidents, stops });
  }

  it('colours a building with a reading by the ramp at its temperature', () => {
    const scene = sceneOf();

    expect(scene.colours.get('zone-a')).toBe(heatColor(heatT(22), stops));
    expect(scene.colours.get('zone-b')).toBe(heatColor(heatT(26.4), stops));
    expect(scene.colours.get('zone-a')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('paints the ends of the scale with the ramp`s own first and last stop', () => {
    const scene = sceneOf({ 'ICS-A': reads(19), 'ICS-B': reads(31), 'ICS-C': reads(23) });

    expect(scene.colours.get('zone-a')).toBe(stops[0]);
    expect(scene.colours.get('zone-b')).toBe(stops[stops.length - 1]);
  });

  it('gives a silent building no colour, a place in the silent set and the label "No data"', () => {
    const scene = sceneOf();

    expect(scene.colours.has('zone-c')).toBe(false);
    expect([...scene.silent]).toEqual(['zone-c']);
    expect(scene.labels.get('zone-c')).toBe('No data');
  });

  it('labels every building: the real temperature to one decimal, also beyond the scale', () => {
    const scene = sceneOf({ 'ICS-A': reads(29.34), 'ICS-C': reads(21) });

    expect(scene.labels.get('zone-a')).toBe('29.3 °C');
    expect(scene.labels.get('zone-b')).toBe('26.4 °C');
    expect(scene.labels.get('zone-c')).toBe('21.0 °C');
    expect(scene.silent.size).toBe(0);
  });

  it('names the silent buildings in the zones` order, not the readings`', () => {
    const scene = sceneOf({ 'ICS-A': entry(), 'ICS-B': entry(), 'ICS-C': entry() });

    expect(scene.silentNames).toEqual(['Beta Hall', 'Alpha Hub', 'Gamma Lab']);
  });

  it('has no silent name when every building reports', () => {
    expect(sceneOf({ 'ICS-C': reads(21) }).silentNames).toEqual([]);
  });

  it('lists the assets with an open incident of their own as alarmed', () => {
    const scene = sceneOf({}, [incident()]);

    expect([...scene.alarmed]).toEqual(['GEN-01']);
  });

  it('counts an acknowledged incident and not a resolved one or one without an asset', () => {
    const acknowledged = incident({ status: 'acknowledged' });
    const resolved = incident({ id: 'inc-2', assetId: 'asset-UPS-01', status: 'resolved' });
    const ofZone = incident({ id: 'inc-3', assetId: null });

    expect([...sceneOf({}, [acknowledged]).alarmed]).toEqual(['GEN-01']);
    expect(sceneOf({}, [resolved]).alarmed.size).toBe(0);
    expect(sceneOf({}, [ofZone]).alarmed.size).toBe(0);
  });

  describe('key', () => {
    it('is equal for two scenes built from the same readings: a tick that changes nothing', () => {
      expect(sceneOf().key).toBe(sceneOf().key);
      expect(sceneOf({}, [incident()]).key).toBe(sceneOf({}, [incident()]).key);
    });

    it('changes with a reading, even by a change that the label rounds away', () => {
      expect(sceneOf({ 'ICS-A': reads(22.01) }).key).not.toBe(sceneOf().key);
    });

    it('changes when a building goes silent or comes back', () => {
      expect(sceneOf({ 'ICS-B': entry() }).key).not.toBe(sceneOf().key);
      expect(sceneOf({ 'ICS-C': reads(23) }).key).not.toBe(sceneOf().key);
    });

    it('changes when an asset goes into alarm or out of it', () => {
      expect(sceneOf({}, [incident()]).key).not.toBe(sceneOf().key);
      expect(sceneOf({}, [incident({ status: 'resolved' })]).key).toBe(sceneOf().key);
    });
  });

  it('is empty for no building', () => {
    const scene = heatSceneOf({ zones: [], readings: new Map(), assets: [], incidents: [], stops });

    expect(scene.colours.size).toBe(0);
    expect(scene.silent.size).toBe(0);
    expect(scene.labels.size).toBe(0);
    expect(scene.silentNames).toEqual([]);
    expect(scene.alarmed.size).toBe(0);
  });
});
