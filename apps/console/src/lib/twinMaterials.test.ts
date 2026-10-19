import { twinColors } from '../styles/tokens';
import { MATERIAL_NAMES, materialSpec } from './twinMaterials';

describe('materialSpec', () => {
  it('knows the contract’s eight names', () => {
    expect([...MATERIAL_NAMES]).toEqual([
      'Part',
      'Steel',
      'Concrete',
      'Rail',
      'Screen',
      'Blade',
      'Hub',
      'Xray',
    ]);
  });

  it.each([
    ['Part', twinColors.idle.top],
    ['Steel', twinColors.steel.top],
    ['Concrete', twinColors.concrete.top],
    ['Rail', twinColors.rail],
    ['Screen', twinColors.screen],
    ['Blade', twinColors.blade],
    ['Hub', twinColors.hub],
  ])('paints %s with its token', (name, color) => {
    expect(materialSpec(name)).toEqual({ name, color, opacity: 1 });
  });

  it('draws Xray as the idle material, see-through', () => {
    expect(materialSpec('Xray')).toEqual({
      name: 'Xray',
      color: twinColors.idle.top,
      opacity: twinColors.xrayOpacity,
    });
  });

  it('makes Xray the only material that is not solid', () => {
    expect(MATERIAL_NAMES.filter((name) => materialSpec(name).opacity < 1)).toEqual(['Xray']);
  });

  it.each([['Chrome'], ['part'], ['']])('falls back to Part for %j', (name) => {
    expect(materialSpec(name)).toEqual(materialSpec('Part'));
    expect(materialSpec(name).name).toBe('Part');
  });

  it('falls back to Part for a material with no name', () => {
    expect(materialSpec(undefined).name).toBe('Part');
  });
});
