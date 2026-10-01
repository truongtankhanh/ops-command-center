import type { Camera } from '@occ/contracts';
import { prioritise } from '../lib/cameras';

const cam = (code: string, zoneId: string, online = true): Camera => ({
  id: code,
  code,
  name: code,
  zoneId,
  position: [0, 0],
  online,
});

describe('prioritise', () => {
  it('puts online cameras of the selected zone first and offline cameras last', () => {
    const cameras = [cam('A', 'z1'), cam('B', 'z2', false), cam('C', 'z2'), cam('D', 'z1', false)];

    expect(prioritise(cameras, 'z2').map((c) => c.code)).toEqual(['C', 'A', 'B', 'D']);
  });
});
