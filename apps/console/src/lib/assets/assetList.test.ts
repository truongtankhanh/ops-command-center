import type { Asset, TelemetryPoint, Zone } from '@occ/contracts';
import {
  assetEmptyMessage,
  assetKey,
  assetNotice,
  groupKey,
  listItems,
  noticeText,
  OTHER_ZONES,
  rowValue,
  stateText,
} from './assetList';
import type { AssetGroup } from './assets';

const point = (overrides: Partial<TelemetryPoint> = {}): TelemetryPoint => ({
  key: 'fanSpeedRpm',
  label: 'Fan speed',
  unit: 'rpm',
  kind: 'number',
  min: null,
  max: null,
  enumValues: null,
  expectedIntervalS: 1,
  headline: 1,
  ...overrides,
});

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
  headline: [point()],
  ...overrides,
});

const zone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-dc',
  code: 'BLD-DC',
  name: 'Data Center',
  kind: 'building',
  polygon: [],
  center: [0, 0],
  ...overrides,
});

describe('listItems', () => {
  const dc = zone();
  const lib = zone({ id: 'zone-lib', code: 'BLD-LIB', name: 'Library' });
  const groups: AssetGroup[] = [
    { zone: dc, assets: [asset(), asset({ id: 'a2', code: 'CT-02' })] },
    { zone: lib, assets: [asset({ id: 'a3', code: 'LKS-B3' })] },
    { zone: null, assets: [asset({ id: 'a4', code: 'X-01' })] },
  ];

  it('lists each header before its assets, in the groups order', () => {
    const items = listItems(groups, true);

    expect(items.map((item) => item.key)).toEqual([
      'group:zone-dc',
      'asset:CT-01',
      'asset:CT-02',
      'group:zone-lib',
      'asset:LKS-B3',
      'group:other',
      'asset:X-01',
    ]);
  });

  it('names the groups and counts their assets', () => {
    const headers = listItems(groups, true).filter((item) => item.kind === 'group');

    expect(headers.map((h) => [h.name, h.count])).toEqual([
      ['Data Center', 2],
      ['Library', 1],
      [OTHER_ZONES, 1],
    ]);
  });

  it('makes a header focusable only when it can set a zone', () => {
    const headers = listItems(groups, true).filter((item) => item.kind === 'group');

    expect(headers.map((h) => h.focusable)).toEqual([true, true, false]);
  });

  it('leaves no header focusable once a zone is chosen', () => {
    const items = listItems([groups[0]!], false);

    expect(items.filter((item) => item.kind === 'group').every((h) => !h.focusable)).toBe(true);
    expect(items.filter((item) => item.kind === 'asset').every((a) => a.focusable)).toBe(true);
  });

  it('is empty for no groups', () => {
    expect(listItems([], true)).toEqual([]);
  });

  it('builds the keys the row and the feed share', () => {
    expect(groupKey(dc)).toBe('group:zone-dc');
    expect(groupKey(null)).toBe('group:other');
    expect(assetKey('CT-01')).toBe('asset:CT-01');
  });
});

describe('rowValue', () => {
  it('formats the first headline point with its unit', () => {
    expect(rowValue(asset(), { values: { fanSpeedRpm: 1420 }, headline: {} })).toBe('1,420 rpm');
  });

  it('prefers the freshest value over the overview headline', () => {
    const entry = { values: { fanSpeedRpm: 1500 }, headline: { fanSpeedRpm: 1420 } };

    expect(rowValue(asset(), entry)).toBe('1,500 rpm');
  });

  it('falls back to the overview headline when no value was received', () => {
    expect(rowValue(asset(), { values: {}, headline: { fanSpeedRpm: 1420 } })).toBe('1,420 rpm');
  });

  it('writes a boolean by its word', () => {
    const sensor = asset({
      headline: [point({ key: 'leakDetected', kind: 'boolean', unit: null })],
    });

    expect(rowValue(sensor, { values: { leakDetected: true }, headline: {} })).toBe('Wet');
    expect(rowValue(sensor, { values: { leakDetected: false }, headline: {} })).toBe('Dry');
  });

  it('keeps a zero, which is a reading', () => {
    expect(rowValue(asset(), { values: { fanSpeedRpm: 0 }, headline: {} })).toBe('0 rpm');
  });

  it('is null with no entry, no value or no headline point', () => {
    expect(rowValue(asset(), undefined)).toBeNull();
    expect(rowValue(asset(), { values: {}, headline: {} })).toBeNull();
    expect(
      rowValue(asset({ headline: [] }), { values: { fanSpeedRpm: 1 }, headline: {} }),
    ).toBeNull();
  });

  it('shows the first headline point, not the second', () => {
    const two = asset({
      headline: [point(), point({ key: 'motorTempC', unit: '°C', headline: 2 })],
    });

    expect(rowValue(two, { values: { fanSpeedRpm: 1420, motorTempC: 71 }, headline: {} })).toBe(
      '1,420 rpm',
    );
  });
});

describe('stateText', () => {
  it('says a fault with the incident that raised it', () => {
    expect(stateText('fault', { ageMs: null, incidentCode: 'INC-000108' })).toBe(
      'Fault · INC-000108',
    );
  });

  it('says a fault with no incident code, which is an unusual but possible lookup', () => {
    expect(stateText('fault', { ageMs: null })).toBe('Fault');
  });

  it('gives no data its age', () => {
    expect(stateText('nodata', { ageMs: 60_000 })).toBe('No data · 1 min');
    expect(stateText('nodata', { ageMs: 12_000 })).toBe('No data · 12 s');
  });

  it('says no data with no age when the asset has no entry', () => {
    expect(stateText('nodata', { ageMs: null })).toBe('No data');
  });

  it('gives offline its age, or none', () => {
    expect(stateText('offline', { ageMs: 3 * 60_000 })).toBe('Offline · 3 min');
    expect(stateText('offline', { ageMs: null })).toBe('Offline');
  });

  it('says running and standby plainly, whatever age is passed', () => {
    expect(stateText('running', { ageMs: 5_000 })).toBe('Running');
    expect(stateText('standby', { ageMs: null })).toBe('Standby');
  });

  it('has no word for an asset it cannot judge', () => {
    expect(stateText('unknown', { ageMs: null })).toBeNull();
  });
});

describe('assetNotice', () => {
  const T1 = '2026-10-15T08:00:00.000Z';
  const T2 = '2026-10-15T08:00:05.000Z';
  const inputs = {
    overview: { 'CT-01': { receivedAt: T1 }, 'CT-02': { receivedAt: T2 } },
    upstreamSince: null,
    socketSince: null,
  };

  it('says nothing while telemetry is live or connecting', () => {
    expect(assetNotice({ ...inputs, pill: 'live' })).toBeNull();
    expect(assetNotice({ ...inputs, pill: 'connecting' })).toBeNull();
  });

  it('reads as of the newest reading while paused', () => {
    expect(assetNotice({ ...inputs, pill: 'paused' })).toEqual({
      kind: 'asOf',
      at: Date.parse(T2),
    });
  });

  it('reads the same while the console is reconnecting', () => {
    expect(assetNotice({ ...inputs, pill: 'reconnecting' })).toEqual({
      kind: 'asOf',
      at: Date.parse(T2),
    });
  });

  it('ignores a reading time it cannot parse', () => {
    const overview = { 'CT-01': { receivedAt: 'soon' }, 'CT-02': { receivedAt: T1 } };

    expect(assetNotice({ ...inputs, overview, pill: 'paused' })).toEqual({
      kind: 'asOf',
      at: Date.parse(T1),
    });
  });

  it('falls back to the API pause time with no reading', () => {
    const notice = assetNotice({
      ...inputs,
      overview: {},
      upstreamSince: T1,
      pill: 'paused',
    });

    expect(notice).toEqual({ kind: 'asOf', at: Date.parse(T1) });
  });

  it('falls back to the socket loss time with no reading while reconnecting', () => {
    const notice = assetNotice({
      ...inputs,
      overview: {},
      socketSince: 1_000,
      pill: 'reconnecting',
    });

    expect(notice).toEqual({ kind: 'asOf', at: 1_000 });
  });

  it('has no time at all when nothing is known', () => {
    const notice = assetNotice({ ...inputs, overview: {}, upstreamSince: 'later', pill: 'paused' });

    expect(notice).toEqual({ kind: 'asOf', at: null });
  });

  it('says unavailable on an API without the namespace', () => {
    expect(assetNotice({ ...inputs, pill: 'unavailable' })).toEqual({ kind: 'unavailable' });
  });
});

describe('noticeText', () => {
  it('writes the time to the second', () => {
    // A local time, so the text does not depend on the runner's timezone.
    const at = new Date(2026, 9, 15, 15, 41, 20).getTime();

    expect(noticeText({ kind: 'asOf', at })).toBe('Readings as of 15:41:20 — not updating');
  });

  it('drops the time when there is none', () => {
    expect(noticeText({ kind: 'asOf', at: null })).toBe('Readings are not updating');
  });

  it('says telemetry is unavailable', () => {
    expect(noticeText({ kind: 'unavailable' })).toBe('No readings: telemetry is unavailable');
  });
});

describe('assetEmptyMessage', () => {
  it('names the search first, whatever the tab and zone', () => {
    expect(assetEmptyMessage('faults', ' pump ', 'Data Center')).toBe('No assets match "pump".');
  });

  it('says why a tab is empty', () => {
    expect(assetEmptyMessage('faults', '', null)).toBe('No assets have a fault.');
    expect(assetEmptyMessage('nodata', '', null)).toBe('No assets are without data.');
  });

  it('names the zone when one is chosen', () => {
    expect(assetEmptyMessage('all', '', 'Library')).toBe('No assets in Library.');
    expect(assetEmptyMessage('faults', '', 'Library')).toBe('No assets in Library have a fault.');
    expect(assetEmptyMessage('nodata', '', 'Library')).toBe(
      'No assets in Library are without data.',
    );
  });

  it('falls back to the empty catalogue', () => {
    expect(assetEmptyMessage('all', '', null)).toBe('No assets are set up on this site.');
  });
});
