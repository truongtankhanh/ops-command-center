import { TWIN_TIERS, tierWord } from './twinTier';

describe('TWIN_TIERS', () => {
  it('lists the tiers from the richest down', () => {
    expect(TWIN_TIERS).toEqual(['high', 'standard', 'low']);
  });
});

describe('tierWord', () => {
  it.each([
    ['high', 'High'],
    ['standard', 'Standard'],
    ['low', 'Low'],
  ] as const)('says %s as "%s"', (tier, word) => {
    expect(tierWord(tier)).toBe(word);
  });

  it('has a word for every tier', () => {
    for (const tier of TWIN_TIERS) expect(tierWord(tier)).toMatch(/^[A-Z][a-z]+$/);
  });
});
