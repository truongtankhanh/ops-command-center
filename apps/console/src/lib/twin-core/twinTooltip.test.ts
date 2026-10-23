import { placeTip, TIP_DELAY_MS, TIP_OFFSET_PX } from './twinTooltip';

const STAGE = { width: 800, height: 600 };
const TIP = { width: 200, height: 100 };

describe('the tooltip’s figures', () => {
  it('are the task’s: 150 ms and 18 px', () => {
    expect(TIP_DELAY_MS).toBe(150);
    expect(TIP_OFFSET_PX).toBe(18);
  });
});

describe('placeTip', () => {
  it('stands to the right of and below the pointer', () => {
    expect(placeTip({ x: 100, y: 100 }, TIP, STAGE)).toEqual({ left: 118, top: 118 });
  });

  it('moves to the left of the pointer when there is no room on the right', () => {
    // 700 + 18 + 200 runs past 800: the tip ends 18 px before the pointer.
    expect(placeTip({ x: 700, y: 100 }, TIP, STAGE)).toEqual({ left: 482, top: 118 });
  });

  it('keeps to the right when the tip just fits', () => {
    expect(placeTip({ x: 582, y: 100 }, TIP, STAGE).left).toBe(600);
  });

  it('ends where the open sheet starts', () => {
    // A 400 px sheet leaves 400 px: 300 + 18 + 200 would run under it.
    expect(placeTip({ x: 300, y: 100 }, TIP, STAGE, 400)).toEqual({ left: 82, top: 118 });
  });

  it('does not run past the bottom', () => {
    expect(placeTip({ x: 100, y: 580 }, TIP, STAGE).top).toBe(500);
  });

  it('does not run past the left edge when it had to move left', () => {
    // A stage 300 wide: the right side does not fit and the left would start at −118.
    expect(placeTip({ x: 100, y: 100 }, TIP, { width: 300, height: 600 }).left).toBe(0);
  });

  it('sits at the top-left of the room when it is bigger than the room', () => {
    expect(placeTip({ x: 100, y: 100 }, { width: 900, height: 700 }, STAGE)).toEqual({
      left: 0,
      top: 0,
    });
  });
});
