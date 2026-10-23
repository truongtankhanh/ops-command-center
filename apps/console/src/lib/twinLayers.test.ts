import { MAP_LAYER_KEYS } from './map/mapLayers';
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

  it('offers the 3D view Incidents, Cameras and Heat at campus level', () => {
    expect(layersOf('3d', 'campus')).toEqual(['incidents', 'cameras', 'heat']);
  });

  it('adds Inside at building level, after Cameras and before Heat', () => {
    expect(layersOf('3d', 'building')).toEqual(['incidents', 'cameras', 'inside', 'heat']);
  });

  it('does not offer Inside at asset and part level, where isolation wins, and keeps Heat', () => {
    expect(layersOf('3d', 'asset')).toEqual(['incidents', 'cameras', 'heat']);
    expect(layersOf('3d', 'part')).toEqual(['incidents', 'cameras', 'heat']);
  });

  it('offers Heat at every level of the 3D view, so its state is never stranded', () => {
    for (const level of LEVELS) expect(layersOf('3d', level)).toContain('heat');
  });

  it('never offers the 2D map Heat', () => {
    for (const level of LEVELS) expect(layersOf('2d', level)).not.toContain('heat');
  });

  it('never offers Assets in 3D: equipment is the scene', () => {
    for (const level of LEVELS) expect(layersOf('3d', level)).not.toContain('assets');
  });
});
