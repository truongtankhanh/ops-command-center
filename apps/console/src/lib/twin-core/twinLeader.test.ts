import type { StagePoint } from './twinLabels';
import { leaderLine, NO_LINE, sameLine } from './twinLeader';

const on = (x: number, y: number): StagePoint => ({ x, y, visible: true });

describe('leaderLine', () => {
  it('runs from the card`s edge to the part`s anchor', () => {
    expect(leaderLine({ x: 264, y: 150 }, on(612, 330))).toEqual({
      x1: 264,
      y1: 150,
      x2: 612,
      y2: 330,
      visible: true,
    });
  });

  it('rounds every coordinate to 0.1 px, so a settled camera writes the same line', () => {
    expect(leaderLine({ x: 264.04, y: 150.06 }, on(612.349, 330.351))).toEqual({
      x1: 264,
      y1: 150.1,
      x2: 612.3,
      y2: 330.4,
      visible: true,
    });
  });

  it('is hidden while the card has not been measured', () => {
    expect(leaderLine(null, on(612, 330))).toBe(NO_LINE);
  });

  it('is hidden when the part has no anchor (the node is gone)', () => {
    expect(leaderLine({ x: 264, y: 150 }, null)).toBe(NO_LINE);
  });

  it('is hidden when the anchor is behind the camera or off the stage', () => {
    expect(leaderLine({ x: 264, y: 150 }, { x: 612, y: 330, visible: false })).toBe(NO_LINE);
  });
});

describe('sameLine', () => {
  const line = leaderLine({ x: 264, y: 150 }, on(612, 330));

  it('is true for the same coordinates', () => {
    expect(sameLine(line, leaderLine({ x: 264, y: 150 }, on(612, 330)))).toBe(true);
  });

  it('is false when the anchor moved by a tenth of a pixel', () => {
    expect(sameLine(line, leaderLine({ x: 264, y: 150 }, on(612.1, 330)))).toBe(false);
  });

  it('is false when the start moved', () => {
    expect(sameLine(line, leaderLine({ x: 270, y: 150 }, on(612, 330)))).toBe(false);
  });

  it('is false between a visible and a hidden line, true between two hidden ones', () => {
    expect(sameLine(line, NO_LINE)).toBe(false);
    expect(sameLine(NO_LINE, line)).toBe(false);
    expect(sameLine(NO_LINE, NO_LINE)).toBe(true);
  });
});
