import { MAP_LAYER_KEYS } from './mapLayers';
import { layersOf } from './twinLayers';
import type { SceneLevel } from './twinLevel';

const LEVELS: SceneLevel[] = ['campus', 'building', 'asset', 'part'];

describe('layersOf', () => {
  it('offers the 2D map its three layers at any level, and never Inside', () => {
    for (const level of LEVELS) {
      expect(layersOf('2d', level)).toEqual(MAP_LAYER_KEYS);
      expect(layersOf('2d', level)).not.toContain('inside');
    }
  });

  it('offers the 3D view Incidents and Cameras at campus level', () => {
    expect(layersOf('3d', 'campus')).toEqual(['incidents', 'cameras']);
  });

  it('adds Inside at building level, after Cameras', () => {
    expect(layersOf('3d', 'building')).toEqual(['incidents', 'cameras', 'inside']);
  });

  it('does not offer Inside at asset and part level, where isolation wins', () => {
    expect(layersOf('3d', 'asset')).toEqual(['incidents', 'cameras']);
    expect(layersOf('3d', 'part')).toEqual(['incidents', 'cameras']);
  });

  it('never offers Assets in 3D: equipment is the scene', () => {
    for (const level of LEVELS) expect(layersOf('3d', level)).not.toContain('assets');
  });
});
