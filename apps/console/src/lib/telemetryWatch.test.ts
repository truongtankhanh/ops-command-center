import { TELEMETRY_WATCH_LIMIT } from '@occ/contracts';
import { deriveWatchSet } from './telemetryWatch';

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
