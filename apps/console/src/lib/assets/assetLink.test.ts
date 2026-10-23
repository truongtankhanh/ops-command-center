import type { Zone } from '@occ/contracts';
import { assetLinkLines } from './assetLink';

const tower = { code: 'CT-01', name: 'Cooling tower 1', elevationM: 14 };
const sensor = { code: 'LKS-B3', name: 'Leak sensor, level 3', elevationM: 8 };

const dataCenter: Pick<Zone, 'name' | 'kind' | 'heightM'> = {
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
};

describe('assetLinkLines', () => {
  it('names the asset by its code and name', () => {
    expect(assetLinkLines(tower, dataCenter, 'Fan motor').heading).toBe('CT-01 · Cooling tower 1');
  });

  it('names the part, in running text, then where the asset stands', () => {
    expect(assetLinkLines(tower, dataCenter, 'Fan motor').detail).toBe(
      'Part: fan motor · Data Center · roof',
    );
  });

  it("writes the model's label as it is, apart from its first letter", () => {
    const yard: typeof dataCenter = { name: 'Plant yard', kind: 'utility', heightM: null };

    expect(assetLinkLines(tower, yard, 'Starter battery').detail).toBe(
      'Part: starter battery · Plant yard',
    );
  });

  it('is the place alone when there is no part label', () => {
    expect(assetLinkLines(tower, dataCenter).detail).toBe('Data Center · roof');
    expect(assetLinkLines(sensor, dataCenter).detail).toBe('Data Center · level 3');
    expect(assetLinkLines(tower, dataCenter, '').detail).toBe('Data Center · roof');
  });

  it('is the part alone when the zone is not known', () => {
    expect(assetLinkLines(tower, undefined, 'Fan motor').detail).toBe('Part: fan motor');
  });

  it('has no detail with neither a part nor a place', () => {
    expect(assetLinkLines(sensor, undefined).detail).toBeNull();
  });
});
