import type { Zone } from '@occ/contracts';
import { assetLinkLines } from './assetLink';

const tower = {
  code: 'CT-01',
  name: 'Cooling tower 1',
  elevationM: 14,
  class: { code: 'cooling_tower' },
};
const generator = {
  code: 'GEN-01',
  name: 'Standby generator',
  elevationM: 0,
  class: { code: 'standby_generator' },
};
const sensor = {
  code: 'LKS-B3',
  name: 'Leak sensor, level 3',
  elevationM: 8,
  class: { code: 'leak_sensor' },
};

const dataCenter: Pick<Zone, 'name' | 'kind' | 'heightM'> = {
  name: 'Data Center',
  kind: 'building',
  heightM: 14,
};

describe('assetLinkLines', () => {
  it('names the asset by its code and name', () => {
    expect(assetLinkLines(tower, dataCenter, 'motorTempC').heading).toBe('CT-01 · Cooling tower 1');
  });

  it('names the part the rule watches, in running text, then where the asset stands', () => {
    expect(assetLinkLines(tower, dataCenter, 'motorTempC').detail).toBe(
      'Part: fan motor · Data Center · roof',
    );
  });

  it('names the part of another class from its own table', () => {
    const yard: typeof dataCenter = { name: 'Plant yard', kind: 'utility', heightM: null };

    expect(assetLinkLines(generator, yard, 'coolantTempC').detail).toBe(
      'Part: engine · Plant yard',
    );
  });

  it('is the place alone when no part is bound to the key', () => {
    expect(assetLinkLines(tower, dataCenter, 'vibrationMms').detail).toBe('Data Center · roof');
  });

  it('is the place alone for a class the console has no part table for', () => {
    expect(assetLinkLines(sensor, dataCenter, 'leakDetected').detail).toBe('Data Center · level 3');
  });

  it('is the part alone when the zone is not known', () => {
    expect(assetLinkLines(tower, undefined, 'motorTempC').detail).toBe('Part: fan motor');
  });

  it('has no detail with neither a part nor a place', () => {
    expect(assetLinkLines(sensor, undefined, 'leakDetected').detail).toBeNull();
  });

  it('does not read a key off an object prototype', () => {
    expect(assetLinkLines(tower, dataCenter, 'constructor').detail).toBe('Data Center · roof');
  });
});
