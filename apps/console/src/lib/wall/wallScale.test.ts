import { WALL_DESIGN_WIDTH, WALL_SCALE_AT_DESIGN, wallScale } from './wallScale';

describe('wallScale', () => {
  it("is frame 18's own factor at the width the frame is drawn at", () => {
    expect(wallScale(WALL_DESIGN_WIDTH)).toBe(WALL_SCALE_AT_DESIGN);
    expect(wallScale(1920)).toBe(1.35);
  });

  it('doubles at 4K, so the picture is the same one', () => {
    expect(wallScale(3840)).toBe(2.7);
  });

  it('moves in steps of 0.05, not on every pixel of a resize', () => {
    expect(wallScale(1919)).toBe(1.35);
    expect(wallScale(1921)).toBe(1.35);
    expect(wallScale(1860)).toBe(1.3);
    expect(wallScale(1980)).toBe(1.4);
  });

  it('stays in a range that cannot break the layout', () => {
    expect(wallScale(0)).toBe(0.5);
    expect(wallScale(100)).toBe(0.5);
    expect(wallScale(100_000)).toBe(4);
  });
});
