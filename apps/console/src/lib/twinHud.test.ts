import { formatHud, HUD_LABEL, HUD_ROWS, NO_VALUE } from './twinHud';
import type { HudReading } from './twinPerf';

const reading = (overrides: Partial<HudReading> = {}): HudReading => ({
  fps: 60,
  frameP95Ms: 11.8,
  calls: 96,
  triangles: 182_000,
  messagesPerSecond: 84,
  postsPerFrame: 1,
  pixelRatio: 1.25,
  ...overrides,
});

describe('HUD_ROWS', () => {
  it('lists frame 00’s six rows in its order and words, then the pixel ratio of V2-19.3', () => {
    expect(HUD_ROWS.map(({ label }) => label)).toEqual([
      'FPS',
      'Frame (p95)',
      'Draw calls',
      'Triangles',
      'Telemetry msgs/s',
      'Worker → main',
      'Pixel ratio',
    ]);
  });

  it('has a unique id for each row', () => {
    expect(new Set(HUD_ROWS.map(({ id }) => id)).size).toBe(HUD_ROWS.length);
  });
});

describe('HUD_LABEL', () => {
  it('names the address that switches the HUD on', () => {
    expect(HUD_LABEL).toContain('debug=twin');
  });
});

describe('formatHud', () => {
  it('gives every row an entry, in the figures of frame 00', () => {
    const shown = formatHud(reading());

    expect(Object.keys(shown).sort()).toEqual(HUD_ROWS.map(({ id }) => id).sort());
    expect(shown).toEqual({
      fps: '60',
      frame: '11.8 ms',
      calls: '96',
      triangles: '182 k',
      messages: '84',
      posts: '1 / frame',
      ratio: '1.25',
    });
  });

  it('rounds the frame rate and the rates to whole numbers', () => {
    const shown = formatHud(reading({ fps: 59.6, messagesPerSecond: 83.4 }));

    expect(shown.fps).toBe('60');
    expect(shown.messages).toBe('83');
  });

  it('shows the p95 with one decimal', () => {
    expect(formatHud(reading({ frameP95Ms: 11.84 })).frame).toBe('11.8 ms');
    expect(formatHud(reading({ frameP95Ms: 14 })).frame).toBe('14.0 ms');
  });

  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1 k'],
    [182_400, '182 k'],
    [250_000, '250 k'],
  ])('shows %d triangles as %s', (triangles, expected) => {
    expect(formatHud(reading({ triangles })).triangles).toBe(expected);
  });

  it.each([
    [0, '0 / frame'],
    [0.5, '0.5 / frame'],
    [0.54, '0.5 / frame'],
    [1, '1 / frame'],
    [1.04, '1 / frame'],
  ])('shows %d posts a frame as %s', (postsPerFrame, expected) => {
    expect(formatHud(reading({ postsPerFrame })).posts).toBe(expected);
  });

  it.each([
    [1.5, '1.5'],
    [1.25, '1.25'],
    [1, '1'],
    [1.0, '1'],
    [4 / 3, '1.33'],
  ])('shows a pixel ratio of %d as %s', (pixelRatio, expected) => {
    expect(formatHud(reading({ pixelRatio })).ratio).toBe(expected);
  });

  it('shows a dash for what has no value', () => {
    const shown = formatHud(
      reading({
        fps: null,
        frameP95Ms: null,
        messagesPerSecond: null,
        postsPerFrame: null,
        pixelRatio: null,
      }),
    );

    expect(shown.fps).toBe(NO_VALUE);
    expect(shown.frame).toBe(NO_VALUE);
    expect(shown.messages).toBe(NO_VALUE);
    expect(shown.posts).toBe(NO_VALUE);
    expect(shown.ratio).toBe(NO_VALUE);
  });

  it('shows a dash for NaN and for infinity, never the word', () => {
    const shown = formatHud(
      reading({
        fps: Number.NaN,
        frameP95Ms: Number.NaN,
        calls: Number.NaN,
        triangles: Number.NaN,
        messagesPerSecond: Number.POSITIVE_INFINITY,
        postsPerFrame: Number.NaN,
        pixelRatio: Number.NaN,
      }),
    );

    expect(Object.values(shown)).toEqual(HUD_ROWS.map(() => NO_VALUE));
  });
});
