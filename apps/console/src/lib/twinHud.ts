import type { BudgetBreach, BudgetFigure, HudReading } from './twinPerf';

/*
 * The words and figures of the developer HUD (V2-19.1, frame 00). A file of its own, apart from `twinPerf.ts`, on
 * purpose: only the HUD imports it, so a production build drops it, and what it holds (`HUD_LABEL`, the row labels) is
 * what `scripts/chunk-budget.ts` looks for in `dist` to prove that the HUD was not shipped. If a label here changes, the
 * script's markers must follow; a spec in `scripts/chunk-budget.test.ts` fails until they do. The text of the budget
 * warning (V2-19.4) lives here too, for the same reason: development-only words stay in the file production drops.
 */

/** The HUD's accessible name; `debug=twin` is the address that switches it on, and the first marker of the build check. */
export const HUD_LABEL = 'Twin performance (debug=twin)';

export type HudRowId = 'fps' | 'frame' | 'calls' | 'triangles' | 'messages' | 'posts' | 'ratio';

/**
 * The rows in frame 00's order and words. A list so that V2-19.3 (pixel ratio) and V2-19.6 (geometries and textures)
 * add a row here and a field to the reading, and no markup.
 */
export const HUD_ROWS: readonly { id: HudRowId; label: string }[] = [
  { id: 'fps', label: 'FPS' },
  { id: 'frame', label: 'Frame (p95)' },
  { id: 'calls', label: 'Draw calls' },
  { id: 'triangles', label: 'Triangles' },
  { id: 'messages', label: 'Telemetry msgs/s' },
  { id: 'posts', label: 'Worker → main' },
  // Added in V2-19.3: not in frame 00, which has six; after them so those keep their places.
  { id: 'ratio', label: 'Pixel ratio' },
];

/** What a row shows when it has no value. */
export const NO_VALUE = '–';

const isValue = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** Frame 00's figures: `60`, `11.8 ms`, `96`, `182 k`, `84`, `1 / frame`, and `1.25` for the ratio. No value, or `NaN`, is a dash. */
export function formatHud(reading: HudReading): Record<HudRowId, string> {
  const whole = (value: number | null): string =>
    isValue(value) ? String(Math.round(value)) : NO_VALUE;
  const triangles = Math.round(reading.triangles);
  return {
    fps: whole(reading.fps),
    frame: isValue(reading.frameP95Ms) ? `${reading.frameP95Ms.toFixed(1)} ms` : NO_VALUE,
    calls: whole(reading.calls),
    triangles: !Number.isFinite(triangles)
      ? NO_VALUE
      : triangles < 1000
        ? String(triangles)
        : `${Math.round(triangles / 1000)} k`,
    messages: whole(reading.messagesPerSecond),
    posts: isValue(reading.postsPerFrame)
      ? `${Number(reading.postsPerFrame.toFixed(1))} / frame`
      : NO_VALUE,
    ratio: isValue(reading.pixelRatio) ? String(Number(reading.pixelRatio.toFixed(2))) : NO_VALUE,
  };
}

const FIGURE_NAME: Record<BudgetFigure, string> = { calls: 'draw calls', triangles: 'triangles' };

/**
 * The development warning for a frame over budget (V2-19.4): each figure with its value and its limit, and where the
 * budget is written. Never names the address that switches the HUD on: `scripts/chunk-budget.ts` looks for that text in
 * `dist`, and a message that carried it would be a false alarm on the day this file ships by mistake.
 */
export function formatBudgetWarning(breaches: readonly BudgetBreach[]): string {
  const figures = breaches
    .map(
      ({ figure, value, limit }) =>
        `${value.toLocaleString('en-US')} ${FIGURE_NAME[figure]} (limit ${limit.toLocaleString('en-US')})`,
    )
    .join(', ');
  return `3D budget exceeded in the last frame: ${figures}. The budget is in the brief § Model contract and ADR-0020 § Budgets.`;
}
