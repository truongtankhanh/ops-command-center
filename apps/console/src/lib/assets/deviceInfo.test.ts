import type { AssetDetail, TelemetryPoint, TelemetryValue, Zone } from '@occ/contracts';
import type { AssetState } from './assets';
import { BATTERY_KEY, type DeviceInfoRow, deviceInfoRows } from './deviceInfo';

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'leakDetected',
  label: 'Leak',
  unit: null,
  kind: 'boolean',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 300,
  headline: 1,
  ...overrides,
});

const BATTERY_POINT = point({
  key: 'batteryPct',
  label: 'Battery',
  unit: '%',
  kind: 'number',
  min: 0,
  max: 100,
  expectedIntervalS: 3600,
  headline: null,
});

/** A device, with the points of a class that has no battery unless a case gives it one. */
const device = (
  overrides: Partial<Pick<AssetDetail, 'points' | 'elevationM' | 'name' | 'code'>> = {},
): Pick<AssetDetail, 'name' | 'code' | 'class' | 'points' | 'elevationM'> => ({
  name: 'Cooling tower 1',
  code: 'CT-01',
  class: {
    id: 'class-cooling-tower',
    code: 'cooling_tower',
    name: 'Cooling tower',
    modelUrl: null,
    footprintM: { width: 1, depth: 1, height: 1 },
  },
  points: [point({ key: 'running', label: 'Running' })],
  elevationM: 8,
  ...overrides,
});

const building: Pick<Zone, 'name' | 'kind' | 'heightM'> = {
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
};

const held = (values: Record<string, TelemetryValue>) => ({ values });

const ids = (rows: DeviceInfoRow[]) => rows.map((row) => row.id);
const row = (rows: DeviceInfoRow[], id: DeviceInfoRow['id']) => rows.find((r) => r.id === id);

describe('deviceInfoRows', () => {
  it('lists the name, the ID, the class, the place and the state, in that order', () => {
    const rows = deviceInfoRows(device(), building, 'running', undefined);

    expect(rows).toEqual([
      { id: 'name', label: 'Device name', value: 'Cooling tower 1' },
      { id: 'code', label: 'Device ID', value: 'CT-01' },
      { id: 'class', label: 'Class', value: 'Cooling tower' },
      { id: 'location', label: 'Location', value: 'Data Center · level 3' },
      { id: 'status', label: 'Status', state: 'running', text: 'Running' },
    ]);
  });

  describe('location', () => {
    const locationOf = (elevationM: number, zone: Pick<Zone, 'name' | 'kind' | 'heightM'>) =>
      row(deviceInfoRows(device({ elevationM }), zone, 'running', undefined), 'location');

    it('is the place line: the zone, then the level or the roof of a building', () => {
      expect(locationOf(14, building)).toEqual({
        id: 'location',
        label: 'Location',
        value: 'Data Center · roof',
      });
      expect(locationOf(0, building)).toEqual({
        id: 'location',
        label: 'Location',
        value: 'Data Center · level 1',
      });
    });

    it('is the zone alone when it is not a building', () => {
      const yard = { name: 'East yard', kind: 'outdoor', heightM: null } as const;

      expect(locationOf(0, yard)).toMatchObject({ value: 'East yard' });
    });

    it('is left out when the zone is not known', () => {
      expect(ids(deviceInfoRows(device(), undefined, 'running', undefined))).toEqual([
        'name',
        'code',
        'class',
        'status',
      ]);
    });
  });

  describe('status', () => {
    it.each([
      ['fault', 'Fault'],
      ['running', 'Running'],
      ['standby', 'Standby'],
      ['nodata', 'No data'],
      ['offline', 'Offline'],
    ] as const)('says %s as "%s", with the state for the card to draw', (state, text) => {
      expect(row(deviceInfoRows(device(), building, state, undefined), 'status')).toEqual({
        id: 'status',
        label: 'Status',
        state,
        text,
      });
    });

    it('has no "since": the card draws the state as the pill does', () => {
      const rows = deviceInfoRows(device(), building, 'offline', held({ running: false }));

      expect(row(rows, 'status')).toMatchObject({ text: 'Offline' });
    });

    it('is left out for a state with no word', () => {
      const unknown: AssetState = 'unknown';

      expect(ids(deviceInfoRows(device(), building, unknown, undefined))).not.toContain('status');
    });
  });

  describe('battery', () => {
    const leakSensor = () => device({ points: [point(), BATTERY_POINT] });

    it('names the key it looks for', () => {
      expect(BATTERY_KEY).toBe('batteryPct');
    });

    it('has no row for a class without a battery point, whatever the entry holds', () => {
      const rows = deviceInfoRows(device(), building, 'running', held({ batteryPct: 92 }));

      expect(ids(rows)).not.toContain('battery');
    });

    it('is the reading and its figure for a class with a battery point', () => {
      const rows = deviceInfoRows(leakSensor(), building, 'running', held({ batteryPct: 92 }));

      expect(row(rows, 'battery')).toEqual({
        id: 'battery',
        label: 'Battery',
        text: '92 %',
        percent: 92,
      });
      expect(rows.at(-1)?.id).toBe('battery');
    });

    it('reads "—" and has no figure while the class has the point and there is no reading', () => {
      const noEntry = deviceInfoRows(leakSensor(), building, 'nodata', undefined);
      const noKey = deviceInfoRows(
        leakSensor(),
        building,
        'running',
        held({ leakDetected: false }),
      );

      for (const rows of [noEntry, noKey]) {
        expect(row(rows, 'battery')).toEqual({
          id: 'battery',
          label: 'Battery',
          text: '—',
          percent: null,
        });
      }
    });

    it('keeps the reading as it came, and has no figure for a value that is not a number', () => {
      const low = deviceInfoRows(leakSensor(), building, 'running', held({ batteryPct: 18.5 }));
      const odd = deviceInfoRows(leakSensor(), building, 'running', held({ batteryPct: true }));

      expect(row(low, 'battery')).toMatchObject({ text: '18.5 %', percent: 18.5 });
      expect(row(odd, 'battery')).toMatchObject({ text: 'true', percent: null });
    });
  });

  it('invents nothing: no zone, no state word and no battery point leave three rows', () => {
    const rows = deviceInfoRows(device(), undefined, 'unknown', held({ batteryPct: 92 }));

    expect(ids(rows)).toEqual(['name', 'code', 'class']);
  });
});
