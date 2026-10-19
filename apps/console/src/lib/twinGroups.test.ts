import { groupsFor, keepIndex, type Span } from './twinGroups';

/** Four things of 6, 12, 6 and 12 entries, one after the other. */
const SPANS: Span[] = [
  { start: 0, count: 6 },
  { start: 6, count: 12 },
  { start: 18, count: 6 },
  { start: 24, count: 12 },
];
const TOTAL = 36;

/** What the groups draw, entry by entry: the material of each. */
const painted = (groups: ReturnType<typeof groupsFor>, total = TOTAL): (number | null)[] => {
  const out: (number | null)[] = new Array<number | null>(total).fill(null);
  for (const { start, count, materialIndex } of groups) {
    for (let i = start; i < start + count; i += 1) out[i] = materialIndex;
  }
  return out;
};

describe('groupsFor (V2-15.7)', () => {
  it('is one group over everything, as drawn, when nothing is kept', () => {
    expect(groupsFor(SPANS, null, TOTAL)).toEqual([{ start: 0, count: TOTAL, materialIndex: 0 }]);
  });

  it('draws the first span as it is and the rest faded: two groups', () => {
    expect(groupsFor(SPANS, 0, TOTAL)).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 30, materialIndex: 1 },
    ]);
  });

  it('draws a span in the middle as it is: three groups, the faded neighbours merged', () => {
    expect(groupsFor(SPANS, 2, TOTAL)).toEqual([
      { start: 0, count: 18, materialIndex: 1 },
      { start: 18, count: 6, materialIndex: 0 },
      { start: 24, count: 12, materialIndex: 1 },
    ]);
  });

  it('draws the last span as it is and the rest faded: two groups', () => {
    expect(groupsFor(SPANS, 3, TOTAL)).toEqual([
      { start: 0, count: 24, materialIndex: 1 },
      { start: 24, count: 12, materialIndex: 0 },
    ]);
  });

  it('is the one span as it is when it is the only thing', () => {
    expect(groupsFor([{ start: 0, count: 6 }], 0, 6)).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
    ]);
  });

  it('tiles the buffer with no gap and no overlap, whichever span is kept', () => {
    for (const keep of [null, 0, 1, 2, 3]) {
      const groups = groupsFor(SPANS, keep, TOTAL);

      expect(painted(groups).every((material) => material !== null)).toBe(true);
      expect(groups.reduce((sum, { count }) => sum + count, 0)).toBe(TOTAL);
    }
  });

  it('draws only the kept span as it is', () => {
    const material = painted(groupsFor(SPANS, 1, TOTAL));

    expect(material.slice(6, 18).every((m) => m === 0)).toBe(true);
    expect([...material.slice(0, 6), ...material.slice(18)].every((m) => m === 1)).toBe(true);
  });

  it('skips a span with nothing in it', () => {
    const spans: Span[] = [
      { start: 0, count: 6 },
      { start: 6, count: 0 },
      { start: 6, count: 6 },
    ];

    expect(groupsFor(spans, 2, 12)).toEqual([
      { start: 0, count: 6, materialIndex: 1 },
      { start: 6, count: 6, materialIndex: 0 },
    ]);
  });

  it('fades everything, in one group, for none', () => {
    expect(groupsFor(SPANS, 'none', TOTAL)).toEqual([{ start: 0, count: TOTAL, materialIndex: 1 }]);
  });

  it('falls back to nothing faded for a span that is not there or no spans at all', () => {
    const all = [{ start: 0, count: TOTAL, materialIndex: 0 }];

    expect(groupsFor(SPANS, 4, TOTAL)).toEqual(all);
    expect(groupsFor(SPANS, -1, TOTAL)).toEqual(all);
    expect(groupsFor([], 0, TOTAL)).toEqual(all);
  });
});

describe('keepIndex (V2-15.7)', () => {
  const items = ['dc', 'lab', 'dorm'];

  it('is null while nothing is isolated: nothing is faded', () => {
    expect(keepIndex(items, false, () => true)).toBeNull();
  });

  it('is the index of the first item the rule leaves alone', () => {
    expect(keepIndex(items, true, (item) => item !== 'lab')).toBe(1);
    expect(keepIndex(items, true, (item) => item === 'dc')).toBe(1);
  });

  it('is none when every item is faded, and for no item at all', () => {
    expect(keepIndex(items, true, () => true)).toBe('none');
    expect(keepIndex([], true, () => false)).toBe('none');
  });
});
