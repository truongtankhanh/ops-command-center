import type { Asset, Incident, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import {
  type AssetState,
  assetStates,
  countAssetFilters,
  groupByZone,
  hasDimmedAsset,
  hasFreshReading,
  matchesAssetFilter,
  matchesAssetQuery,
  openIncidentOf,
  placeLabel,
} from './assets';
import { searchTerms } from './incidents/incidents';
import type { AssetTelemetryState } from './telemetryState';

const NOW = Date.parse('2026-10-15T08:00:00.000Z');

const point = (key: string, headline: 1 | 2, expectedIntervalS: number): TelemetryPoint => ({
  key,
  label: key,
  unit: null,
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS,
  headline,
});

/** A cooling tower: 1 s and 5 s headline points, so it is stale after the 5 s floor. */
const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-ct-01',
  code: 'CT-01',
  name: 'Cooling tower 1',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 14,
  headingDeg: 0,
  headline: [point('fanSpeedRpm', 1, 1), point('motorTempC', 2, 5)],
  ...overrides,
});

const ofClass = (code: string, overrides: Partial<Asset> = {}): Asset => {
  const base = asset();
  return asset({ class: { ...base.class, code }, ...overrides });
};

const zone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
  polygon: [],
  center: [108.44, 11.95],
  ...overrides,
});

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc-1',
  code: 'INC-000108',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Water leak',
  description: null,
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: 'asset-ct-01',
  reportedAt: '2026-10-15T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** What the console holds of one asset: received `ageMs` before `NOW`. */
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

/** The state of one asset, alone in the catalogue. */
function stateOf(
  subject: Asset,
  overview: Record<string, AssetTelemetryState>,
  incidents: Incident[] = [],
  now: number | null = NOW,
): AssetState | undefined {
  return assetStates([subject], incidents, overview, now).get(subject.code);
}

describe('assetStates', () => {
  describe('worked examples of asset-classes.md', () => {
    it('CT-02: fresh, `running` false, no incident is standby', () => {
      const ct02 = asset({ id: 'a-ct-02', code: 'CT-02' });
      const overview = { 'CT-02': entry({ values: { running: false, fanSpeedRpm: 0 } }) };
      expect(stateOf(ct02, overview)).toBe('standby');
    });

    it('GEN-01: with an open incident and a reading older than 180 s, it is a fault', () => {
      const gen = ofClass('standby_generator', {
        id: 'a-gen-01',
        code: 'GEN-01',
        headline: [point('fuelLevelPct', 1, 60), point('coolantTempC', 2, 60)],
      });
      const overview = { 'GEN-01': entry({ ageMs: 200_000, values: { running: false } }) };
      const raised = incident({ assetId: 'a-gen-01' });

      expect(stateOf(gen, overview, [raised])).toBe('fault');
      // Without the incident the same reading is simply stale.
      expect(stateOf(gen, overview)).toBe('nodata');
    });

    it('LKS-B3: a leak sensor is running until an incident makes it a fault', () => {
      const leak = ofClass('leak_sensor', {
        id: 'a-lks-b3',
        code: 'LKS-B3',
        headline: [point('leakDetected', 1, 300), point('batteryPct', 2, 3600)],
      });
      const overview = { 'LKS-B3': entry({ values: { leakDetected: true } }) };

      expect(stateOf(leak, overview)).toBe('running');
      expect(stateOf(leak, overview, [incident({ assetId: 'a-lks-b3' })])).toBe('fault');
    });
  });

  describe('a fault', () => {
    it('is a fault even when the asset is also stale, offline or has no overview entry', () => {
      const raised = [incident()];
      expect(stateOf(asset(), { 'CT-01': entry({ ageMs: 60_000 }) }, raised)).toBe('fault');
      expect(stateOf(asset(), { 'CT-01': entry({ online: false }) }, raised)).toBe('fault');
      expect(stateOf(asset(), {}, raised)).toBe('fault');
    });

    it('counts an acknowledged incident, not a resolved one', () => {
      const overview = { 'CT-01': entry({ values: { running: true } }) };
      expect(stateOf(asset(), overview, [incident({ status: 'acknowledged' })])).toBe('fault');
      expect(stateOf(asset(), overview, [incident({ status: 'resolved' })])).toBe('running');
    });

    it('matches the asset by id, never by code or by another asset', () => {
      const overview = { 'CT-01': entry({ values: { running: true } }) };
      expect(stateOf(asset(), overview, [incident({ assetId: 'CT-01' })])).toBe('running');
      expect(stateOf(asset(), overview, [incident({ assetId: 'asset-other' })])).toBe('running');
      expect(stateOf(asset(), overview, [incident({ assetId: null })])).toBe('running');
      expect(stateOf(asset(), overview, [incident({ assetId: undefined })])).toBe('running');
    });
  });

  describe('no data and offline', () => {
    it('is no data when the overview has no entry for the asset', () => {
      expect(stateOf(asset(), {})).toBe('nodata');
    });

    it('is offline when the device is offline', () => {
      expect(stateOf(asset(), { 'CT-01': entry({ online: false }) })).toBe('offline');
    });

    it('is offline, not no data, when the device is offline and its reading is also stale', () => {
      const overview = { 'CT-01': entry({ online: false, ageMs: 600_000 }) };
      expect(stateOf(asset(), overview)).toBe('offline');
    });

    it('is no data once the reading is as old as the threshold, and not before', () => {
      // Shortest headline interval 1 s: three of them is 3 s, raised to the 5 s floor.
      const values = { running: true };
      expect(stateOf(asset(), { 'CT-01': entry({ ageMs: 4_999, values }) })).toBe('running');
      expect(stateOf(asset(), { 'CT-01': entry({ ageMs: 5_000, values }) })).toBe('nodata');
    });

    it('judges staleness by the shortest headline interval of the asset', () => {
      const slow = ofClass('standby_generator', {
        headline: [point('fuelLevelPct', 1, 60), point('coolantTempC', 2, 60)],
      });
      const values = { running: true };
      expect(stateOf(slow, { 'CT-01': entry({ ageMs: 179_000, values }) })).toBe('running');
      expect(stateOf(slow, { 'CT-01': entry({ ageMs: 180_000, values }) })).toBe('nodata');
    });

    it('never judges staleness before the server clock is known', () => {
      const overview = { 'CT-01': entry({ ageMs: 3_600_000, values: { running: true } }) };
      expect(stateOf(asset(), overview, [], null)).toBe('running');
    });

    it('never judges an asset with no headline point stale', () => {
      const bare = asset({ headline: [] });
      const overview = { 'CT-01': entry({ ageMs: 3_600_000, values: { running: true } }) };
      expect(stateOf(bare, overview)).toBe('running');
    });
  });

  describe('standby, running and unknown', () => {
    it('is standby when `running` is false and running when it is true', () => {
      expect(stateOf(asset(), { 'CT-01': entry({ values: { running: false } }) })).toBe('standby');
      expect(stateOf(asset(), { 'CT-01': entry({ values: { running: true } }) })).toBe('running');
    });

    it('is unknown, never running, when a class with a state point has no value for it', () => {
      expect(stateOf(asset(), { 'CT-01': entry({ values: { fanSpeedRpm: 0 } }) })).toBe('unknown');
    });

    it('is unknown when the state value is not of the type it should be', () => {
      expect(stateOf(asset(), { 'CT-01': entry({ values: { running: 'false' } }) })).toBe(
        'unknown',
      );
      expect(stateOf(asset(), { 'CT-01': entry({ values: { running: 0 } }) })).toBe('unknown');
    });

    it('reads `running` from a state point that is not in the headline', () => {
      // V2-09.2: the overview carries it whatever its rank; the reducer lays it over `values`.
      const overview = { 'CT-01': entry({ values: { fanSpeedRpm: 0, running: false } }) };
      expect(stateOf(asset(), overview)).toBe('standby');
    });

    it('is running for a class that has no state point', () => {
      const leak = ofClass('leak_sensor');
      expect(stateOf(leak, { 'CT-01': entry({ values: { leakDetected: false } }) })).toBe(
        'running',
      );
    });

    it('is running for a class this console does not know', () => {
      const odd = ofClass('hovercraft');
      expect(stateOf(odd, { 'CT-01': entry() })).toBe('running');
    });

    it.each<[string, TelemetryValue | undefined, AssetState]>([
      ['down is standby', 'down', 'standby'],
      ['up is running', 'up', 'running'],
      ['moving is running', 'moving', 'running'],
      ['no value is unknown', undefined, 'unknown'],
      ['a number is unknown', 1, 'unknown'],
    ])('a barrier arm: %s', (_name, armPosition, expected) => {
      const arm = ofClass('barrier_arm', { headline: [point('armPosition', 1, 2)] });
      const values: Record<string, TelemetryValue> =
        armPosition === undefined ? {} : { armPosition };
      expect(stateOf(arm, { 'CT-01': entry({ values }) })).toBe(expected);
    });
  });

  it('answers for every asset, by its code', () => {
    const second = asset({ id: 'a2', code: 'CT-02' });
    const states = assetStates(
      [asset(), second],
      [],
      { 'CT-01': entry({ values: { running: true } }) },
      NOW,
    );
    expect([...states]).toEqual([
      ['CT-01', 'running'],
      ['CT-02', 'nodata'],
    ]);
  });
});

describe('hasDimmedAsset', () => {
  const ct01 = asset();
  const ct02 = asset({ id: 'asset-ct-02', code: 'CT-02' });

  it('is false when every asset reports, live', () => {
    const overview = { 'CT-01': entry(), 'CT-02': entry() };

    expect(hasDimmedAsset([ct01, ct02], overview, NOW)).toBe(false);
  });

  it('is true for an asset with no entry', () => {
    expect(hasDimmedAsset([ct01, ct02], { 'CT-01': entry() }, NOW)).toBe(true);
  });

  it('is true for an asset whose device is offline', () => {
    const overview = { 'CT-01': entry(), 'CT-02': entry({ online: false }) };

    expect(hasDimmedAsset([ct01, ct02], overview, NOW)).toBe(true);
  });

  it('is true for an asset whose reading is older than its threshold, and not before it', () => {
    // 1 s and 5 s headline points: stale from the 5 s floor.
    const overview = (ageMs: number) => ({ 'CT-01': entry({ ageMs }) });

    expect(hasDimmedAsset([ct01], overview(4_999), NOW)).toBe(false);
    expect(hasDimmedAsset([ct01], overview(5_000), NOW)).toBe(true);
  });

  it('counts a stale fault: unlike the list, an open incident does not hide it', () => {
    const overview = { 'CT-01': entry({ ageMs: 60_000 }) };

    expect(assetStates([ct01], [incident()], overview, NOW).get('CT-01')).toBe('fault');
    expect(hasDimmedAsset([ct01], overview, NOW)).toBe(true);
  });

  it('cannot judge without a server clock, so a reading is not stale', () => {
    const overview = { 'CT-01': entry({ ageMs: 60_000 }) };

    expect(hasDimmedAsset([ct01], overview, null)).toBe(false);
  });

  it('is false for no asset', () => {
    expect(hasDimmedAsset([], {}, NOW)).toBe(false);
  });
});

describe('hasFreshReading', () => {
  const ct01 = asset();

  it('is true for an online entry that is not stale', () => {
    expect(hasFreshReading(ct01, entry(), NOW)).toBe(true);
  });

  it('is false with no entry', () => {
    expect(hasFreshReading(ct01, undefined, NOW)).toBe(false);
  });

  it('is false when the device is offline, however recent its last reading', () => {
    expect(hasFreshReading(ct01, entry({ online: false }), NOW)).toBe(false);
  });

  it('is false from the asset`s threshold on, and true just before it', () => {
    // 1 s and 5 s headline points: stale from the 5 s floor.
    expect(hasFreshReading(ct01, entry({ ageMs: 4_999 }), NOW)).toBe(true);
    expect(hasFreshReading(ct01, entry({ ageMs: 5_000 }), NOW)).toBe(false);
  });

  it('uses the asset`s own threshold: a slower class stays fresh longer', () => {
    // A 60 s point: 180 s, as an indoor climate sensor.
    const sensor = asset({ headline: [point('indoorTempC', 1, 60)] });

    expect(hasFreshReading(sensor, entry({ ageMs: 179_999 }), NOW)).toBe(true);
    expect(hasFreshReading(sensor, entry({ ageMs: 180_000 }), NOW)).toBe(false);
  });

  it('cannot judge without a server clock, so a reading is not stale', () => {
    expect(hasFreshReading(ct01, entry({ ageMs: 60_000 }), null)).toBe(true);
  });

  it('still says an offline device is not fresh without a clock', () => {
    expect(hasFreshReading(ct01, entry({ online: false }), null)).toBe(false);
  });

  it('does not look at an open incident: a fault with a fresh reading is fresh', () => {
    const overview = { 'CT-01': entry() };

    expect(assetStates([ct01], [incident()], overview, NOW).get('CT-01')).toBe('fault');
    expect(hasFreshReading(ct01, overview['CT-01'], NOW)).toBe(true);
  });

  it('narrows the entry, so a caller can read it after the check', () => {
    const held: AssetTelemetryState | undefined = entry({ values: { indoorTempC: 22 } });

    if (hasFreshReading(ct01, held, NOW)) {
      expect(held.values.indoorTempC).toBe(22);
    } else {
      expect.unreachable('the reading is fresh');
    }
  });
});

describe('openIncidentOf', () => {
  it('is undefined without an unresolved incident of the asset', () => {
    expect(openIncidentOf(asset(), [])).toBeUndefined();
    expect(openIncidentOf(asset(), [incident({ status: 'resolved' })])).toBeUndefined();
    expect(openIncidentOf(asset(), [incident({ assetId: 'other' })])).toBeUndefined();
  });

  it('picks the most severe, then the newest, as the feed lists them', () => {
    const list = [
      incident({ id: 'low', severity: 'low' }),
      incident({ id: 'high-old', severity: 'high', reportedAt: '2026-10-15T07:00:00.000Z' }),
      incident({ id: 'high-new', severity: 'high', reportedAt: '2026-10-15T07:55:00.000Z' }),
      incident({ id: 'resolved', severity: 'critical', status: 'resolved' }),
    ];
    expect(openIncidentOf(asset(), list)?.id).toBe('high-new');
  });
});

describe('groupByZone', () => {
  const zones = [
    zone({ id: 'z-util', name: 'Utility Plant', code: 'UTL-PLANT' }),
    zone({ id: 'z-dc', name: 'Data Center' }),
    zone({ id: 'z-empty', name: 'Library' }),
  ];

  it('groups by zone name A–Z and assets by code within a group', () => {
    const assets = [
      asset({ id: '1', code: 'CH-01', zoneId: 'z-util' }),
      asset({ id: '2', code: 'GEN-01', zoneId: 'z-dc' }),
      asset({ id: '3', code: 'CT-01', zoneId: 'z-dc' }),
    ];
    const groups = groupByZone(assets, zones);

    expect(groups.map((g) => g.zone?.name)).toEqual(['Data Center', 'Utility Plant']);
    expect(groups.map((g) => g.assets.map((a) => a.code))).toEqual([
      ['CT-01', 'GEN-01'],
      ['CH-01'],
    ]);
  });

  it('leaves out a zone with no asset', () => {
    const groups = groupByZone([asset({ zoneId: 'z-dc' })], zones);
    expect(groups.map((g) => g.zone?.id)).toEqual(['z-dc']);
  });

  it('puts assets of an unknown zone last, in one group with no zone', () => {
    const assets = [
      asset({ id: '1', code: 'ZZ-01', zoneId: 'gone' }),
      asset({ id: '2', code: 'AA-01', zoneId: 'z-util' }),
      asset({ id: '3', code: 'BB-01', zoneId: 'gone-too' }),
    ];
    const groups = groupByZone(assets, zones);

    expect(groups.map((g) => g.zone?.id ?? null)).toEqual(['z-util', null]);
    expect(groups[1]!.assets.map((a) => a.code)).toEqual(['BB-01', 'ZZ-01']);
  });

  it('keeps every asset in one unlabelled group while the zones are not loaded', () => {
    const groups = groupByZone([asset()], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.zone).toBeNull();
  });

  it('is empty without assets, and changes neither input', () => {
    const assets = [asset({ code: 'B' }), asset({ code: 'A' })];
    const before = assets.map((a) => a.code);
    expect(groupByZone([], zones)).toEqual([]);
    groupByZone(assets, zones);
    expect(assets.map((a) => a.code)).toEqual(before);
    expect(zones.map((z) => z.id)).toEqual(['z-util', 'z-dc', 'z-empty']);
  });
});

describe('matchesAssetQuery', () => {
  const subject = { name: 'Cooling tower 1', code: 'CT-01' };

  it('matches everything when there are no terms', () => {
    expect(matchesAssetQuery(subject, searchTerms('   '))).toBe(true);
  });

  it('matches on name, code and zone name', () => {
    expect(matchesAssetQuery(subject, searchTerms('tower'))).toBe(true);
    expect(matchesAssetQuery(subject, searchTerms('ct-01'))).toBe(true);
    expect(matchesAssetQuery(subject, searchTerms('data'), 'Data Center')).toBe(true);
    expect(matchesAssetQuery(subject, searchTerms('library'), 'Data Center')).toBe(false);
  });

  it('needs every term, in any field', () => {
    expect(matchesAssetQuery(subject, searchTerms('tower data'), 'Data Center')).toBe(true);
    expect(matchesAssetQuery(subject, searchTerms('tower library'), 'Data Center')).toBe(false);
  });

  it('folds case and accents', () => {
    expect(matchesAssetQuery({ name: 'Máy phát', code: 'GEN-01' }, searchTerms('MAY PHAT'))).toBe(
      true,
    );
    expect(matchesAssetQuery(subject, searchTerms('CÓ'), 'Có zone')).toBe(true);
  });

  it('does not let a term run from one field into the next', () => {
    // "1" ends the name and "ct" starts the code: no single field contains "1ct".
    expect(matchesAssetQuery(subject, ['1ct'])).toBe(false);
  });
});

describe('matchesAssetFilter and countAssetFilters', () => {
  const states = new Map<string, AssetState>([
    ['A', 'fault'],
    ['B', 'nodata'],
    ['C', 'offline'],
    ['D', 'running'],
    ['E', 'standby'],
    ['F', 'unknown'],
  ]);
  const assets = [...states.keys()].map((code) => asset({ id: code, code }));

  it('puts faults in Faults, and no data and offline in No data', () => {
    expect(matchesAssetFilter('fault', 'faults')).toBe(true);
    expect(matchesAssetFilter('nodata', 'faults')).toBe(false);
    expect(matchesAssetFilter('nodata', 'nodata')).toBe(true);
    expect(matchesAssetFilter('offline', 'nodata')).toBe(true);
    expect(matchesAssetFilter('running', 'nodata')).toBe(false);
  });

  it('keeps an asset with no state word, or none at all, in All only', () => {
    expect(matchesAssetFilter('unknown', 'all')).toBe(true);
    expect(matchesAssetFilter('unknown', 'faults')).toBe(false);
    expect(matchesAssetFilter(undefined, 'all')).toBe(true);
    expect(matchesAssetFilter(undefined, 'nodata')).toBe(false);
  });

  it('counts each tab', () => {
    expect(countAssetFilters(assets, states)).toEqual({ all: 6, faults: 1, nodata: 2 });
  });

  it('counts only what the search and the zone chip let through', () => {
    const counts = countAssetFilters(assets, states, (a) => a.code !== 'A' && a.code !== 'B');
    expect(counts).toEqual({ all: 4, faults: 0, nodata: 1 });
  });
});

describe('placeLabel', () => {
  // The table of asset-classes.md § Place line.
  it.each<[string, number, Partial<Zone>, string]>([
    ['CT-01', 14, { name: 'Data Center', heightM: 14 }, 'Data Center · roof'],
    ['AHU-H1', 24, { name: 'Innovation Hub', heightM: 24 }, 'Innovation Hub · roof'],
    ['FH-L1', 4, { name: 'Science Lab', heightM: 16 }, 'Science Lab · level 2'],
    ['LKS-B3', 8, { name: 'Dormitory B', heightM: 20 }, 'Dormitory B · level 3'],
    ['AHU-L1', 0, { name: 'Library', heightM: 18 }, 'Library · level 1'],
    ['BAR-01', 0, { name: 'Main Gate', kind: 'gate', heightM: null }, 'Main Gate'],
  ])('%s', (_code, elevationM, overrides, expected) => {
    expect(placeLabel({ elevationM }, zone(overrides))).toBe(expected);
  });

  it('invents nothing for an elevation that is not a floor', () => {
    expect(placeLabel({ elevationM: 5 }, zone({ heightM: 14 }))).toBe('Data Center');
  });

  it('reads a zone with no height as having no roof', () => {
    expect(placeLabel({ elevationM: 14 }, zone({ heightM: null }))).toBe('Data Center');
    expect(placeLabel({ elevationM: 0 }, zone({ heightM: undefined }))).toBe(
      'Data Center · level 1',
    );
  });

  it('uses roof and level for buildings only', () => {
    const plant = zone({ name: 'Utility Plant', kind: 'utility', heightM: 8 });
    expect(placeLabel({ elevationM: 8 }, plant)).toBe('Utility Plant');
  });

  it('has no line without a zone', () => {
    expect(placeLabel({ elevationM: 0 }, undefined)).toBeNull();
  });
});
