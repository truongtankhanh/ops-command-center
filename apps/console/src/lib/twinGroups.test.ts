import { groupsForLooks, type Span, type SpanLook } from './twinGroups';
import { presenceMap } from './twinLevel';

/** Four things of 6, 12, 6 and 12 entries, one after the other. */
const SPANS: Span[] = [
  { start: 0, count: 6 },
  { start: 6, count: 12 },
  { start: 18, count: 6 },
  { start: 24, count: 12 },
];
const TOTAL = 36;

/** What the groups draw, entry by entry: the material of each. */
const painted = (groups: ReturnType<typeof groupsForLooks>, total = TOTAL): (number | null)[] => {
  const out: (number | null)[] = new Array<number | null>(total).fill(null);
  for (const { start, count, materialIndex } of groups) {
    for (let i = start; i < start + count; i += 1) out[i] = materialIndex;
  }
  return out;
};

describe('groupsForLooks (V2-15.8)', () => {
  it('is one group over everything, as drawn, when every span is drawn or there are none', () => {
    const all = [{ start: 0, count: TOTAL, materialIndex: 0 }];

    expect(groupsForLooks(SPANS, ['drawn', 'drawn', 'drawn', 'drawn'], TOTAL)).toEqual(all);
    expect(groupsForLooks([], [], TOTAL)).toEqual(all);
  });

  it('gives each look its material: drawn 0, faded 1, see-through 2', () => {
    expect(groupsForLooks(SPANS, ['faded', 'xray', 'drawn', 'faded'], TOTAL)).toEqual([
      { start: 0, count: 6, materialIndex: 1 },
      { start: 6, count: 12, materialIndex: 2 },
      { start: 18, count: 6, materialIndex: 0 },
      { start: 24, count: 12, materialIndex: 1 },
    ]);
  });

  it('merges neighbours of one look: the see-through building between faded runs is three groups', () => {
    expect(groupsForLooks(SPANS, ['faded', 'faded', 'xray', 'faded'], TOTAL)).toEqual([
      { start: 0, count: 18, materialIndex: 1 },
      { start: 18, count: 6, materialIndex: 2 },
      { start: 24, count: 12, materialIndex: 1 },
    ]);
  });

  it('leaves a hidden span out of every group, and it breaks the merge of the spans around it', () => {
    const groups = groupsForLooks(SPANS, ['faded', 'hidden', 'faded', 'drawn'], TOTAL);

    expect(groups).toEqual([
      { start: 0, count: 6, materialIndex: 1 },
      { start: 18, count: 6, materialIndex: 1 },
      { start: 24, count: 12, materialIndex: 0 },
    ]);
    expect(
      painted(groups)
        .slice(6, 18)
        .every((material) => material === null),
    ).toBe(true);
  });

  it('is no group at all when everything is hidden: nothing is drawn or hit', () => {
    expect(groupsForLooks(SPANS, ['hidden', 'hidden', 'hidden', 'hidden'], TOTAL)).toEqual([]);
  });

  it('tiles the buffer with no gap and no overlap when nothing is hidden, whatever the looks', () => {
    const looks: SpanLook[][] = [
      ['faded', 'drawn', 'faded', 'faded'],
      ['xray', 'faded', 'faded', 'faded'],
      ['faded', 'faded', 'faded', 'xray'],
      ['drawn', 'xray', 'drawn', 'faded'],
    ];

    for (const each of looks) {
      const groups = groupsForLooks(SPANS, each, TOTAL);

      expect(painted(groups).every((material) => material !== null)).toBe(true);
      expect(groups.reduce((sum, { count }) => sum + count, 0)).toBe(TOTAL);
    }
  });

  it('draws only the drawn span as it is', () => {
    const material = painted(groupsForLooks(SPANS, ['faded', 'drawn', 'faded', 'faded'], TOTAL));

    expect(material.slice(6, 18).every((m) => m === 0)).toBe(true);
    expect([...material.slice(0, 6), ...material.slice(18)].every((m) => m === 1)).toBe(true);
  });

  it('skips a span with nothing in it', () => {
    const spans: Span[] = [
      { start: 0, count: 6 },
      { start: 6, count: 0 },
      { start: 6, count: 6 },
    ];

    expect(groupsForLooks(spans, ['drawn', 'faded', 'faded'], 12)).toEqual([
      { start: 0, count: 6, materialIndex: 0 },
      { start: 6, count: 6, materialIndex: 1 },
    ]);
  });

  it('treats a span with no look as drawn', () => {
    const looks: SpanLook[] = ['faded'];

    expect(groupsForLooks(SPANS, looks, TOTAL)).toEqual([
      { start: 0, count: 6, materialIndex: 1 },
      { start: 6, count: 30, materialIndex: 0 },
    ]);
  });

  describe('the draw calls of the boxes at building level (AC2, the pure half)', () => {
    // The shape of the seed, in the order `placeAssets` gives it (by code): code, zone, placement.
    const SEED: [string, string, 'outdoor' | 'roof' | 'inside'][] = [
      ['AHU-C1', 'BLD-CLINIC', 'inside'],
      ['AHU-H1', 'BLD-HUB', 'roof'],
      ['AHU-L1', 'BLD-LIB', 'inside'],
      ['BAR-01', 'GATE-MAIN', 'outdoor'],
      ['BAR-02', 'GATE-EAST', 'outdoor'],
      ['BAT-01', 'BLD-DC', 'inside'],
      ['CH-01', 'UTL-PLANT', 'outdoor'],
      ['CRAC-01', 'BLD-DC', 'inside'],
      ['CRAC-02', 'BLD-DC', 'inside'],
      ['CT-01', 'BLD-DC', 'roof'],
      ['CT-02', 'BLD-DC', 'roof'],
      ['FH-L1', 'BLD-LAB', 'inside'],
      ['GAS-L1', 'BLD-LAB', 'inside'],
      ['GEN-01', 'BLD-DC', 'outdoor'],
      ['ICS-ADMIN', 'BLD-ADMIN', 'inside'],
      ['ICS-DC', 'BLD-DC', 'inside'],
      ['ICS-DORA', 'BLD-DORA', 'inside'],
      ['ICS-DORB', 'BLD-DORB', 'inside'],
      ['ICS-LAB', 'BLD-LAB', 'inside'],
      ['ICS-LHA', 'BLD-LHA', 'inside'],
      ['ICS-SEC', 'BLD-SEC', 'inside'],
      ['ICS-SPORTS', 'BLD-SPORTS', 'inside'],
      ['ICS-STU', 'BLD-STU', 'inside'],
      ['LFT-A2', 'BLD-DORA', 'inside'],
      ['LFT-B1', 'BLD-DORB', 'inside'],
      ['LFT-H1', 'BLD-HUB', 'inside'],
      ['LKS-B3', 'BLD-DORB', 'inside'],
      ['PMP-S1', 'BLD-STU', 'inside'],
      ['SWG-01', 'UTL-PLANT', 'outdoor'],
      ['TR-01', 'UTL-PLANT', 'outdoor'],
      ['UPS-01', 'BLD-DC', 'inside'],
    ];
    const BOX_INDICES = 36;
    const spans: Span[] = SEED.map((_, index) => ({
      start: index * BOX_INDICES,
      count: BOX_INDICES,
    }));
    const total = SEED.length * BOX_INDICES;
    const looksFor = (zoneId: string | null): SpanLook[] => {
      const focus = zoneId === null ? null : { zoneId, assetCode: null };
      const presence = presenceMap(
        SEED.map(([code, zone, placement]) => ({ code, zoneId: zone, placement })),
        focus,
      );
      return SEED.map(([code]) => {
        const look = presence.get(code) ?? 'drawn';
        return look === 'xray' ? 'drawn' : look;
      });
    };

    it('costs at most two groups for each drawn box plus one, whatever the interleaving', () => {
      const looks = looksFor('BLD-DC');
      const drawn = looks.filter((look) => look === 'drawn').length;
      const groups = groupsForLooks(spans, looks, total);

      expect(drawn).toBe(8);
      expect(groups.length).toBeLessThanOrEqual(2 * drawn + 1);
      expect(groups.length).toBeLessThan(150);
    });

    it('draws the eight boxes of the Data Center as they are and hides the other inside ones', () => {
      const looks = looksFor('BLD-DC');
      const groups = groupsForLooks(spans, looks, total);
      const material = painted(groups, total);

      for (const [index, [code]] of SEED.entries()) {
        const first = material[index * BOX_INDICES];
        const expected = { drawn: 0, faded: 1, xray: 2, hidden: null }[looks[index] ?? 'drawn'];

        expect([code, first]).toEqual([code, expected]);
      }
    });

    it('draws every remaining box as it is at campus level, with the inside ones left out', () => {
      const groups = groupsForLooks(spans, looksFor(null), total);

      expect(groups.every(({ materialIndex }) => materialIndex === 0)).toBe(true);
    });
  });
});
