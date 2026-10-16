import { type Incident, TELEMETRY_WATCH_LIMIT } from '@occ/contracts';
import { deriveWatchSet, incidentWatchCode } from './telemetryWatch';

describe('deriveWatchSet', () => {
  it('puts the inspected asset first, then the incident asset', () => {
    expect(deriveWatchSet({ inspected: 'CT-01', incident: 'LKS-B3' })).toEqual(['CT-01', 'LKS-B3']);
  });

  it('is the inspected asset alone, or the incident asset alone', () => {
    expect(deriveWatchSet({ inspected: 'CT-01', incident: null })).toEqual(['CT-01']);
    expect(deriveWatchSet({ inspected: null, incident: 'LKS-B3' })).toEqual(['LKS-B3']);
  });

  it('is empty when nothing is inspected and no incident has an asset', () => {
    expect(deriveWatchSet({ inspected: null, incident: null })).toEqual([]);
  });

  it('drops an empty code', () => {
    expect(deriveWatchSet({ inspected: '', incident: 'CT-02' })).toEqual(['CT-02']);
  });

  it('lists an asset once when the incident is about the inspected asset', () => {
    expect(deriveWatchSet({ inspected: 'CT-01', incident: 'CT-01' })).toEqual(['CT-01']);
  });

  it('never exceeds the watch limit and keeps the inspected asset when it cuts', () => {
    const set = deriveWatchSet({ inspected: 'CT-01', incident: 'CT-02' }, 1);

    expect(set).toEqual(['CT-01']);
    expect(deriveWatchSet({ inspected: 'CT-01', incident: 'CT-02' }).length).toBeLessThanOrEqual(
      TELEMETRY_WATCH_LIMIT,
    );
  });

  it('is empty for a limit of zero', () => {
    expect(deriveWatchSet({ inspected: 'CT-01', incident: 'CT-02' }, 0)).toEqual([]);
  });

  it('gives equal arrays for equal inputs, as new arrays', () => {
    const inputs = { inspected: 'CT-01', incident: 'CT-02' };

    const first = deriveWatchSet(inputs);
    const second = deriveWatchSet(inputs);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('leaves its input alone', () => {
    const inputs = Object.freeze({ inspected: 'CT-01', incident: 'CT-02' });

    expect(() => deriveWatchSet(inputs)).not.toThrow();
  });
});

describe('incidentWatchCode', () => {
  const assets = [
    { id: 'asset-ct-01', code: 'CT-01' },
    { id: 'asset-lks-b3', code: 'LKS-B3' },
  ];

  const incident = (overrides: Partial<Incident> = {}): Incident => ({
    id: 'incident-1',
    code: 'INC-000107',
    type: 'equipment_fault',
    severity: 'critical',
    status: 'open',
    title: 'Motor over-temperature — Cooling tower 1',
    description: null,
    zoneId: 'zone-dc',
    position: [108.44, 11.95],
    source: 'telemetry',
    assetId: 'asset-ct-01',
    reportedAt: '2026-10-16T08:00:00.000Z',
    acknowledgedAt: null,
    resolvedAt: null,
    version: 1,
    ...overrides,
  });

  it('is the code of the asset of an open telemetry incident', () => {
    expect(incidentWatchCode(incident(), assets)).toBe('CT-01');
  });

  it('still watches while the incident is acknowledged', () => {
    expect(incidentWatchCode(incident({ status: 'acknowledged' }), assets)).toBe('CT-01');
  });

  it('is null once the incident is resolved', () => {
    expect(incidentWatchCode(incident({ status: 'resolved' }), assets)).toBeNull();
  });

  it('is null for an incident a person or the simulator reported', () => {
    expect(incidentWatchCode(incident({ source: 'operator' }), assets)).toBeNull();
    expect(incidentWatchCode(incident({ source: 'simulator' }), assets)).toBeNull();
  });

  it('is null without an asset id, or with one the catalogue does not have', () => {
    expect(incidentWatchCode(incident({ assetId: null }), assets)).toBeNull();
    expect(incidentWatchCode(incident({ assetId: undefined }), assets)).toBeNull();
    expect(incidentWatchCode(incident({ assetId: 'asset-gone' }), assets)).toBeNull();
    expect(incidentWatchCode(incident(), [])).toBeNull();
  });

  it('gives deriveWatchSet a second asset when the inspector is on another one', () => {
    const code = incidentWatchCode(incident(), assets);

    expect(deriveWatchSet({ inspected: 'LKS-B3', incident: code })).toEqual(['LKS-B3', 'CT-01']);
  });
});
