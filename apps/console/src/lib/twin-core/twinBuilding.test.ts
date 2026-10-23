import type { Asset, Incident, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import { assetStates } from './assets/assets';
import { assetsText, buildingEyebrow, buildingSummary, incidentsText } from './twinBuilding';
import { buildingReadings, heatLabel, tempText } from './twinHeat';
import type { AssetTelemetryState } from './telemetry/telemetryState';

const NOW = Date.parse('2026-10-19T08:00:00.000Z');

const point = (key: string, expectedIntervalS = 1): TelemetryPoint => ({
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

const asset = (code: string, overrides: Partial<Asset> = {}): Asset => ({
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
  zoneId: 'zone-dc',
  position: [108.44, 11.95],
  elevationM: 0,
  headingDeg: 0,
  headline: [point('loadPct')],
  ...overrides,
});

/** A climate sensor: the one kind of asset here with an `indoorTempC` point. */
const sensor = (code: string, overrides: Partial<Asset> = {}): Asset =>
  asset(code, { headline: [point('indoorTempC')], ...overrides });

const zone: Pick<Zone, 'id'> = { id: 'zone-dc' };

const incident = (overrides: Partial<Incident> = {}): Incident => ({
  id: 'inc-1',
  code: 'INC-000105',
  type: 'equipment_fault',
  severity: 'high',
  status: 'open',
  title: 'Fault',
  description: null,
  zoneId: 'zone-other',
  position: [108.44, 11.95],
  source: 'telemetry',
  assetId: null,
  reportedAt: '2026-10-19T07:50:00.000Z',
  acknowledgedAt: null,
  resolvedAt: null,
  version: 1,
  ...overrides,
});

/** What the console holds of an asset: received `ageMs` before `NOW`, 5 s being the stale floor. */
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

/** The heat reading of `zone`, as the card asks for it. */
function readingOf(
  assets: Asset[],
  overview: Record<string, AssetTelemetryState>,
  now: number | null = NOW,
) {
  return buildingReadings([{ ...zone, kind: 'building' }], assets, overview, now).get(zone.id);
}

/** The summary of `zone` with the states `assetStates` gives and the heat reading, as the card computes it. */
function summaryOf(
  assets: Asset[],
  overview: Record<string, AssetTelemetryState>,
  incidents: Incident[] = [],
  now: number | null = NOW,
) {
  const states = assetStates(assets, incidents, overview, now);
  return buildingSummary(zone, assets, states, incidents, readingOf(assets, overview, now));
}

/** Eight assets as the seed's Data Center holds them: five inside, two on the roof, one outdoors. */
const DATA_CENTER = [
  asset('BAT-01'),
  asset('CRAC-01'),
  asset('CRAC-02'),
  asset('CT-01'),
  asset('CT-02'),
  asset('GEN-01'),
  sensor('ICS-DC'),
  asset('UPS-01'),
];

const allReporting = () =>
  Object.fromEntries(
    DATA_CENTER.map((a) => [a.code, entry({ values: { running: true, indoorTempC: 22.1 } })]),
  );

describe('buildingSummary', () => {
  describe('assets', () => {
    it('counts every asset of the zone, `GEN-01` included, and not another zone`s', () => {
      const elsewhere = asset('AHU-H1', { zoneId: 'zone-hub' });

      const { assets } = summaryOf([...DATA_CENTER, elsewhere], allReporting());

      expect(assets.total).toBe(8);
    });

    it('has no asset without data when every reading is fresh', () => {
      expect(summaryOf(DATA_CENTER, allReporting()).assets.noData).toBe(0);
    });

    it('counts a stale reading, an offline device and an asset with no reading as without data', () => {
      const overview: Record<string, AssetTelemetryState> = {
        ...allReporting(),
        'UPS-01': entry({ ageMs: 60_000 }),
        'BAT-01': entry({ online: false }),
      };
      delete overview['CRAC-01'];

      expect(summaryOf(DATA_CENTER, overview).assets.noData).toBe(3);
    });

    it('counts a stale fault as reporting, as the Assets tab does (a fault is never hidden by staleness)', () => {
      const overview = { ...allReporting(), 'UPS-01': entry({ ageMs: 60_000 }) };
      const raised = incident({ assetId: 'asset-UPS-01' });

      expect(summaryOf(DATA_CENTER, overview, [raised]).assets.noData).toBe(0);
    });

    it('is zero for a zone with no asset', () => {
      expect(summaryOf([], {}).assets).toEqual({ total: 0, noData: 0 });
    });
  });

  describe('incidents', () => {
    it('has none and no first code when nothing is active in the building', () => {
      expect(summaryOf(DATA_CENTER, allReporting()).incidents).toEqual({
        count: 0,
        firstCode: null,
      });
    });

    it('counts an incident that names the zone', () => {
      const raised = incident({ zoneId: 'zone-dc' });

      expect(summaryOf(DATA_CENTER, allReporting(), [raised]).incidents).toEqual({
        count: 1,
        firstCode: 'INC-000105',
      });
    });

    it('counts an incident raised at an asset of the zone even when it names another zone', () => {
      const raised = incident({ zoneId: 'zone-other', assetId: 'asset-UPS-01' });

      expect(summaryOf(DATA_CENTER, allReporting(), [raised]).incidents.count).toBe(1);
    });

    it('counts an incident once when it names both the zone and an asset of it', () => {
      const raised = incident({ zoneId: 'zone-dc', assetId: 'asset-UPS-01' });

      expect(summaryOf(DATA_CENTER, allReporting(), [raised]).incidents.count).toBe(1);
    });

    it('counts acknowledged incidents and not resolved ones', () => {
      const acknowledged = incident({ id: 'a', zoneId: 'zone-dc', status: 'acknowledged' });
      const resolved = incident({ id: 'b', zoneId: 'zone-dc', status: 'resolved' });

      expect(summaryOf(DATA_CENTER, allReporting(), [acknowledged, resolved]).incidents.count).toBe(
        1,
      );
    });

    it('ignores incidents of other zones and of other buildings` assets', () => {
      const other = incident({ zoneId: 'zone-hub', assetId: 'asset-AHU-H1' });

      expect(summaryOf(DATA_CENTER, allReporting(), [other]).incidents.count).toBe(0);
    });

    it('names the most severe first, then the newest, as the feed lists them', () => {
      const medium = incident({
        id: 'm',
        code: 'INC-000001',
        zoneId: 'zone-dc',
        severity: 'medium',
        reportedAt: '2026-10-19T07:59:00.000Z',
      });
      const olderCritical = incident({
        id: 'c1',
        code: 'INC-000002',
        zoneId: 'zone-dc',
        severity: 'critical',
        reportedAt: '2026-10-19T07:00:00.000Z',
      });
      const newerCritical = incident({
        id: 'c2',
        code: 'INC-000003',
        zoneId: 'zone-dc',
        severity: 'critical',
        reportedAt: '2026-10-19T07:30:00.000Z',
      });

      const { incidents } = summaryOf(DATA_CENTER, allReporting(), [
        medium,
        olderCritical,
        newerCritical,
      ]);

      expect(incidents).toEqual({ count: 3, firstCode: 'INC-000003' });
    });

    it('does not reorder the list it is given', () => {
      const first = incident({ id: 'a', zoneId: 'zone-dc', severity: 'low' });
      const second = incident({ id: 'b', zoneId: 'zone-dc', severity: 'critical' });
      const list = [first, second];

      summaryOf(DATA_CENTER, allReporting(), list);

      expect(list).toEqual([first, second]);
    });
  });

  describe('indoor', () => {
    it('reads the sensor`s fresh `indoorTempC`', () => {
      expect(summaryOf(DATA_CENTER, allReporting()).indoorC).toBe(22.1);
    });

    it('averages the fresh sources, whatever their order: the code order does not choose the number', () => {
      const overview = {
        'ICS-A': entry({ values: { indoorTempC: 21 } }),
        'ICS-B': entry({ values: { indoorTempC: 25 } }),
      };

      expect(summaryOf([sensor('ICS-B'), sensor('ICS-A')], overview).indoorC).toBe(23);
      expect(summaryOf([sensor('ICS-A'), sensor('ICS-B')], overview).indoorC).toBe(23);
    });

    it('skips a stale source and reads the fresh one alone', () => {
      const assets = [sensor('ICS-A'), sensor('ICS-B')];
      const overview = {
        'ICS-A': entry({ ageMs: 60_000, values: { indoorTempC: 21 } }),
        'ICS-B': entry({ values: { indoorTempC: 25 } }),
      };

      expect(summaryOf(assets, overview).indoorC).toBe(25);
    });

    it('skips an offline source', () => {
      const overview = {
        'ICS-DC': entry({ online: false, values: { indoorTempC: 22.1 } }),
      };

      expect(summaryOf(DATA_CENTER, overview).indoorC).toBeNull();
    });

    it('is null when the only source is stale: a stale number is not shown as live', () => {
      const overview = { 'ICS-DC': entry({ ageMs: 60_000, values: { indoorTempC: 22.1 } }) };

      expect(summaryOf(DATA_CENTER, overview).indoorC).toBeNull();
    });

    it('is null when the building has no source of the reading', () => {
      const noSensor = DATA_CENTER.filter((a) => a.code !== 'ICS-DC');

      expect(summaryOf(noSensor, allReporting()).indoorC).toBeNull();
    });

    it('is null when the source has no reading yet or its value is not a number', () => {
      expect(summaryOf(DATA_CENTER, {}).indoorC).toBeNull();
      expect(
        summaryOf(DATA_CENTER, { 'ICS-DC': entry({ values: { indoorTempC: 'n/a' } }) }).indoorC,
      ).toBeNull();
    });

    it('does not judge staleness without a server clock', () => {
      const overview = { 'ICS-DC': entry({ ageMs: 60_000, values: { indoorTempC: 22.1 } }) };

      expect(summaryOf(DATA_CENTER, overview, [], null).indoorC).toBe(22.1);
    });

    it('is read from the point, not from the class: an air handler counts too', () => {
      const handler = asset('AHU-DC', {
        class: { ...asset('x').class, code: 'air_handler' },
        headline: [point('indoorTempC')],
      });
      const overview = { 'AHU-DC': entry({ values: { indoorTempC: 23.4 } }) };

      expect(summaryOf([handler], overview).indoorC).toBe(23.4);
    });

    it('is null when the reading is silent or there is none to give', () => {
      const states = assetStates(DATA_CENTER, [], allReporting(), NOW);

      expect(buildingSummary(zone, DATA_CENTER, states, [], 'silent').indoorC).toBeNull();
      expect(buildingSummary(zone, DATA_CENTER, states, [], undefined).indoorC).toBeNull();
    });

    it('is the number the heat overlay shows for the building: the card and the overlay agree', () => {
      const assets = [sensor('ICS-A'), sensor('ICS-B')];
      const overview = {
        'ICS-A': entry({ values: { indoorTempC: 22.04 } }),
        'ICS-B': entry({ values: { indoorTempC: 24.1 } }),
      };

      const { indoorC } = summaryOf(assets, overview);
      const reading = readingOf(assets, overview) ?? 'silent';

      expect(reading).not.toBe('silent');
      expect(indoorC).toBeCloseTo(23.07, 10);
      expect(indoorC === null ? 'none' : tempText(indoorC)).toBe(heatLabel(reading));
      expect(heatLabel(reading)).toBe('23.1 °C');
    });
  });
});

describe('buildingEyebrow', () => {
  it('reads the use as a word', () => {
    expect(buildingEyebrow({ use: 'data_center' })).toBe('Building · data center');
    expect(buildingEyebrow({ use: 'administration' })).toBe('Building · administration');
  });

  it('reads "Building" for a zone with no use, which an older API never sends', () => {
    expect(buildingEyebrow({ use: null })).toBe('Building');
    expect(buildingEyebrow({})).toBe('Building');
  });

  it('shows a use this console does not know as it is, spaced', () => {
    const unknown = { use: 'cold_storage' } as unknown as Pick<Zone, 'use'>;

    expect(buildingEyebrow(unknown)).toBe('Building · cold storage');
  });
});

describe('assetsText', () => {
  it('says all reporting when none is without data', () => {
    expect(assetsText({ total: 8, noData: 0 })).toBe('8 · all reporting');
  });

  it('counts the assets without data', () => {
    expect(assetsText({ total: 8, noData: 1 })).toBe('8 · 1 without data');
    expect(assetsText({ total: 8, noData: 3 })).toBe('8 · 3 without data');
  });

  it('is just "0" for a building with no asset', () => {
    expect(assetsText({ total: 0, noData: 0 })).toBe('0');
  });
});

describe('incidentsText', () => {
  it('gives the count and the first code', () => {
    expect(incidentsText({ count: 1, firstCode: 'INC-000105' })).toBe('1 · INC-000105');
    expect(incidentsText({ count: 3, firstCode: 'INC-000105' })).toBe('3 · INC-000105');
  });

  it('says "None" when there is no incident', () => {
    expect(incidentsText({ count: 0, firstCode: null })).toBe('None');
  });
});
