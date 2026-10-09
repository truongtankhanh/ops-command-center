/**
 * Contrast proof for the console's design tokens (docs/design/tokens.md).
 *
 *   node scripts/contrast.ts           rewrite the generated part of docs/design/tokens.md
 *   node scripts/contrast.ts --check   only report; run by `pnpm lint`
 *
 * Both modes exit 1 when a checked pair is below its minimum, or when a token value that has to be
 * copied out of tokens.css (MapLibre, index.html, favicon.svg cannot read custom properties) no
 * longer matches it, when the copy of favicon.svg the title badge draws over has drifted, or when
 * the wall breakpoints in tokens.ts no longer match the media queries of tokens.css. Plain
 * Node 24 with type stripping and no dependency, so it stays cheap to run in lint. Ratios use the
 * WCAG 2.x relative-luminance formula.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { breakpoints, faviconMark, mapColors, mapMotion } from '../src/styles/tokens.ts';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Pair {
  fg: string;
  bg: string;
  min: number;
  /** Opaque surface under a translucent background (a badge tint). */
  over?: string;
  /** Measured and published, never failed on — with the reason. */
  reportOnly?: string;
}

const TOKENS_CSS = new URL('../src/styles/tokens.css', import.meta.url);
const INDEX_HTML = new URL('../index.html', import.meta.url);
const FAVICON_SVG = new URL('../public/favicon.svg', import.meta.url);
const TOKENS_MD = new URL('../../../docs/design/tokens.md', import.meta.url);
const START = '<!-- contrast:start -->';
const END = '<!-- contrast:end -->';

const TEXT = 4.5; // WCAG 1.4.3, normal text
const UI = 3; // WCAG 1.4.11, boundaries that carry meaning

const SURFACES = ['--surface-0', '--surface-1', '--surface-2', '--surface-3'];
const SEVERITIES = ['--sev-critical', '--sev-high', '--sev-medium', '--sev-low'];
const MATRIX_ROWS = [
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--accent',
  ...SEVERITIES,
  '--status-resolved',
  '--success',
  '--warning',
  '--danger',
  '--border-strong',
  '--border-subtle',
];
const MAP: Record<string, string> = {
  'map ground': mapColors.ground,
  'map zone outline': mapColors.zoneOutline,
  'map boundary': mapColors.site.boundaryFill,
  ...Object.fromEntries(
    Object.entries(mapColors.zoneFill).map(([kind, fill]) => [`map zone ${kind}`, fill]),
  ),
};
const ZONE_FILLS = Object.keys(mapColors.zoneFill).map((kind) => `map zone ${kind}`);

// Which token sits on which surface: the surface rules in docs/design/brief.md.
const PAIRS: Pair[] = [
  ...cross(
    ['--text-primary', '--text-secondary', '--text-tertiary', '--status-resolved', '--accent'],
    SURFACES,
    TEXT,
  ),
  { fg: '--on-accent', bg: '--accent', min: TEXT },
  ...cross(SEVERITIES, SURFACES.slice(0, 3), TEXT),
  { fg: '--sev-critical', bg: '--surface-3', min: TEXT, reportOnly: 'icon only on surface-3' },
  ...cross(['--success', '--warning', '--danger'], SURFACES.slice(1), TEXT),
  ...cross(['--border-strong'], SURFACES.slice(0, 2), UI),
  // Camera tiles and viewer (`CameraTile`, `CameraFeed`): the pills and caption over the picture are a
  // 75–90 % `--camera-ground`, measured as the solid ground; the LIVE dot is a graphic next to its
  // label. A frame with no picture is striped `--camera-off-a` / `-b`.
  ...cross(['--text-primary', '--text-secondary'], ['--camera-ground'], TEXT),
  { fg: '--success', bg: '--camera-ground', min: UI },
  ...cross(['--text-primary', '--text-secondary'], ['--camera-off-a', '--camera-off-b'], TEXT),
  { fg: 'map zone outline', bg: 'map ground', min: UI },
  { fg: '--text-secondary', bg: 'map ground', min: TEXT },
  // Inside the campus the zones, their labels and the selected incident's zone outline sit on the
  // site boundary's fill, not on the ground; the highlight also crosses every zone fill.
  { fg: 'map zone outline', bg: 'map boundary', min: UI },
  { fg: '--text-secondary', bg: 'map boundary', min: TEXT },
  ...cross(['--accent'], ['map boundary', ...ZONE_FILLS], UI),
  // The map tooltip on `--surface-3`: the severity label is `--text-primary`, the hue is only on the
  // icon (a graphic) — critical text would fail there (see above).
  ...cross(SEVERITIES, ['--surface-3'], UI),
  // `SeverityBadge` and the checked severity option in `SegmentedControl`, both on `--surface-1`:
  // the label stays `--text-primary` on the tint, and the hue is only on the icon (a graphic, 3:1).
  ...SEVERITIES.map((sev) => ({
    fg: '--text-primary',
    bg: `${sev}-bg`,
    over: '--surface-1',
    min: TEXT,
  })),
  ...SEVERITIES.map((sev) => ({ fg: sev, bg: `${sev}-bg`, over: '--surface-1', min: UI })),
  // `StatusChip` pill for a resolved incident, in the incident detail.
  { fg: '--status-resolved', bg: '--status-resolved-bg', over: '--surface-1', min: TEXT },
  // The escalated critical KPI tile in the header: count and label in `--text-primary`, the hue on
  // the icon only (a graphic, 3:1). The tint is already opaque, so it needs no surface under it.
  { fg: '--text-primary', bg: '--sev-critical-hot-bg', min: TEXT },
  { fg: '--sev-critical', bg: '--sev-critical-hot-bg', min: UI },
  // A fresh feed row (frame 04) takes its severity's badge tint over `--surface-1`. The title and the
  // severity tile reuse the badge pairs above; the meta line (code included), a late age and a
  // resolved status chip sit on the same tint. The code is `--text-secondary`, not the mockup's
  // `--text-tertiary`, which falls to 4.48:1 on the medium tint.
  ...SEVERITIES.flatMap((sev) =>
    ['--text-secondary', '--warning', '--status-resolved'].map((fg) => ({
      fg,
      bg: `${sev}-bg`,
      over: '--surface-1',
      min: TEXT,
    })),
  ),
  // The count on the selected feed tab.
  { fg: '--text-primary', bg: '--accent-tint', over: '--surface-1', min: TEXT },
  // The type glyph on an open incident's severity disc on the map (a graphic), and the severity icon
  // tile of a critical / high toast. The other marker colours on the map ground are the
  // `--surface-0` pairs above.
  ...SEVERITIES.map((sev) => ({ fg: '--on-accent', bg: sev, min: UI })),
  // The sign-in screens' state glyph on its tinted circle, on the `--surface-1` card (frames 09–11;
  // a graphic, 3:1). The busy circle is `--text-secondary` on `--surface-2`, a pair above.
  { fg: '--warning', bg: '--warning-tint', over: '--surface-1', min: UI },
  { fg: '--danger', bg: '--danger-tint', over: '--surface-1', min: UI },
  // UI-14 adds no new pair: the toast's kicker, title and detail and its severity border are the
  // `--surface-3` pairs above; a fresh critical row keeps the fresh-row tint pairs; the user menu's
  // sound switch is `--text-secondary` on `--surface-0` (off) and `--on-accent` on `--accent` (on).
  // Digital twin (V2, frame 00), measured on the top face, the lightest of the three. The edge of a
  // hovered, selected or alarmed part bounds it against the ground and its idle neighbours, so those
  // pairs are held to 3:1; between the part's own faces it only draws the shape.
  ...cross(['--accent', ...SEVERITIES], ['--tw-top', '--tw-ground'], UI),
  {
    fg: '--accent',
    bg: '--tw-hover-top',
    min: UI,
    reportOnly: 'between the part’s own faces; held on the ground and idle neighbours',
  },
  // The alarm faces are the critical reference mix; the other severities are mixed by the scene.
  ...SEVERITIES.map((sev) => ({
    fg: sev,
    bg: '--tw-alarm-top',
    min: UI,
    reportOnly: 'between the part’s own faces; held on the ground and idle neighbours',
  })),
  // A stale part's dashed edge is dim on purpose: stale is the dash, the stopped motion and the age
  // on every value (brief § Principles 3), not a brighter outline.
  {
    fg: '--tw-stale-edge',
    bg: '--tw-stale-top',
    min: UI,
    reportOnly: 'dim on purpose; the dash, stopped motion and value ages carry stale',
  },
  // 3D labels (`--text-secondary`, haloed with `--surface-0`) over the campus ground.
  { fg: '--text-secondary', bg: '--tw-ground', min: TEXT },
  // The heat ramp's ends on the ground: lightness carries the value, not a boundary.
  ...['--heat-0', '--heat-5'].map((fg) => ({
    fg,
    bg: '--tw-ground',
    min: UI,
    reportOnly: 'lightness carries the value; the legend and the Assets tab carry the number',
  })),
];

const tokensCss = readFileSync(TOKENS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const css = parseRoot(tokensCss);
const check = process.argv.includes('--check');

const results = PAIRS.map((pair) => ({ ...pair, ratio: ratioOf(pair) }));
const failures = results.filter((r) => !r.reportOnly && r.ratio < r.min);
const drift = copiedTokens();
const drifted = drift.filter((d) => d.actual !== d.expected);

if (!check) {
  const md = readFileSync(TOKENS_MD, 'utf8');
  const start = md.indexOf(START);
  const end = md.indexOf(END);
  if (start < 0 || end < start)
    throw new Error(`${START} … ${END} markers not found in ${TOKENS_MD.pathname}`);
  writeFileSync(TOKENS_MD, `${md.slice(0, start + START.length)}\n\n${report()}\n${md.slice(end)}`);
}

for (const f of failures) {
  console.error(`contrast: ${f.fg} on ${f.bg} is ${f.ratio.toFixed(2)}:1, needs ${f.min}:1`);
}
for (const d of drifted) {
  console.error(`contrast: ${d.copy} is ${d.actual}, tokens.css says ${d.expected}`);
}
if (failures.length || drifted.length) {
  process.exitCode = 1;
} else {
  const checked = results.filter((r) => !r.reportOnly).length;
  console.log(`contrast: ${checked} pairs pass, ${drift.length} copied tokens match`);
}

function cross(fgs: string[], bgs: string[], min: number): Pair[] {
  return fgs.flatMap((fg) => bgs.map((bg) => ({ fg, bg, min })));
}

/** The first `:root { … }` block of `source` (comments already stripped). */
function parseRoot(source: string): Map<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(source);
  if (!root) throw new Error('no :root block in tokens.css');
  const tokens = new Map<string, string>();
  for (const [, name, value] of root[1]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(name!, value!.trim());
  }
  return tokens;
}

function resolve(ref: string): Rgba {
  const mapped = MAP[ref];
  if (mapped) return parseColour(mapped, ref);
  const value = css.get(ref);
  if (value === undefined) throw new Error(`${ref} is not defined in tokens.css`);
  return parseColour(value, ref);
}

function parseColour(value: string, ref: string): Rgba {
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join('') : hex[1]!;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    return { r: r!, g: g!, b: b!, a: 1 };
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a: rgb[4] === undefined ? 1 : +rgb[4] };
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  if (variable) return resolve(variable[1]!);
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+%|var\(--[\w-]+\))\s*,\s*(.+)\)$/.exec(value);
  if (mix) {
    const weight = percentage(mix[2]!, ref);
    return mixSrgb(parseColour(mix[1]!, ref), parseColour(mix[3]!, ref), weight / 100);
  }
  throw new Error(`${ref}: cannot read colour "${value}"`);
}

/** A `color-mix` weight: `35%`, or a token holding one (`--tw-alarm-mix`). */
function percentage(value: string, ref: string): number {
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  const resolved = variable ? css.get(variable[1]!) : value;
  const percent = resolved === undefined ? null : /^([\d.]+)%$/.exec(resolved);
  if (!percent) throw new Error(`${ref}: cannot read percentage "${value}"`);
  return +percent[1]!;
}

/** CSS Color 5 `color-mix(in srgb, …)`: interpolates premultiplied by alpha. */
function mixSrgb(first: Rgba, second: Rgba, weight: number): Rgba {
  const a = first.a * weight + second.a * (1 - weight);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (c1: number, c2: number) =>
    (c1 * first.a * weight + c2 * second.a * (1 - weight)) / a;
  return {
    r: channel(first.r, second.r),
    g: channel(first.g, second.g),
    b: channel(first.b, second.b),
    a,
  };
}

function over(top: Rgba, below: Rgba): Rgba {
  const channel = (c1: number, c2: number) => c1 * top.a + c2 * (1 - top.a);
  return {
    r: channel(top.r, below.r),
    g: channel(top.g, below.g),
    b: channel(top.b, below.b),
    a: 1,
  };
}

function ratioOf({ fg, bg, over: under }: Pair): number {
  let background = resolve(bg);
  if (background.a < 1) {
    if (!under) throw new Error(`${bg} is translucent: name the surface under it`);
    background = over(background, resolve(under));
  }
  return contrast(over(resolve(fg), background), background);
}

function contrast(a: Rgba, b: Rgba): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function hexOf(colour: Rgba): string {
  return `#${[colour.r, colour.g, colour.b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function normalise(hex: string): string {
  return hexOf(parseColour(hex.toLowerCase(), hex));
}

function copiedTokens(): { copy: string; actual: string; expected: string }[] {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const themeColor = /<meta\s+name="theme-color"\s+content="(#[0-9a-f]+)"/i.exec(html)?.[1];
  const svg = readFileSync(FAVICON_SVG, 'utf8');
  const sorted = (hexes: string[]) => [...new Set(hexes)].sort().join(', ');
  // The wall media queries (`--ui-scale`), in file order: wall, then wall4k.
  const minWidths = [...tokensCss.matchAll(/@media\s*\(\s*min-width:\s*(\d+)px\s*\)/g)].map(
    ([, px]) => `${px}px`,
  );
  const mapCopies: [copy: string, value: string, token: string][] = [
    ['ground', mapColors.ground, '--surface-0'],
    ...Object.entries(mapColors.severity).map(([severity, value]): [string, string, string] => [
      `severity.${severity}`,
      value,
      `--sev-${severity}`,
    ]),
    ['surface1', mapColors.surface1, '--surface-1'],
    ['surface3', mapColors.surface3, '--surface-3'],
    ['accent', mapColors.accent, '--accent'],
    ['onAccent', mapColors.onAccent, '--on-accent'],
    ['textPrimary', mapColors.textPrimary, '--text-primary'],
    ['textSecondary', mapColors.textSecondary, '--text-secondary'],
    ['textTertiary', mapColors.textTertiary, '--text-tertiary'],
  ];
  return [
    ...mapCopies.map(([copy, value, token]) => ({
      copy: `\`mapColors.${copy}\` (src/styles/tokens.ts)`,
      actual: normalise(value),
      expected: hexOf(resolve(token)),
    })),
    {
      copy: '`mapMotion.pulseMs` (src/styles/tokens.ts)',
      actual: `${mapMotion.pulseMs}ms`,
      expected: css.get('--duration-pulse') ?? 'missing',
    },
    ...(['wall', 'wall4k'] as const).map((mode, i) => ({
      copy: `\`breakpoints.${mode}\` (src/styles/tokens.ts)`,
      actual: `${breakpoints[mode]}px`,
      expected: minWidths[i] ?? 'missing',
    })),
    {
      copy: '`theme-color` (index.html)',
      actual: themeColor ? normalise(themeColor) : 'missing',
      expected: hexOf(resolve('--surface-1')),
    },
    {
      // Compared as markup, not colours: the badge redraws the whole mark from this copy.
      copy: '`faviconMark` (src/styles/tokens.ts)',
      actual: faviconMark === svg.trim() ? 'public/favicon.svg' : 'differs',
      expected: 'public/favicon.svg',
    },
    {
      copy: 'colours in public/favicon.svg',
      actual: sorted([...svg.matchAll(/#[0-9a-f]{3,6}\b/gi)].map(([hex]) => normalise(hex))),
      expected: sorted(['--surface-0', '--text-primary', '--accent'].map((t) => hexOf(resolve(t)))),
    },
  ];
}

function report(): string {
  const name = (ref: string) => `\`${ref}\``;
  const lines = [
    '<!-- Generated by `pnpm --filter @occ/console tokens:contrast` — do not edit between the markers. -->',
    '',
    '### Every colour token on every surface',
    '',
    `| Token | Value | ${SURFACES.map((s) => `${name(s)} ${hexOf(resolve(s))}`).join(' | ')} |`,
    `| --- | --- | ${SURFACES.map(() => '---').join(' | ')} |`,
    ...MATRIX_ROWS.map(
      (row) =>
        `| ${name(row)} | ${hexOf(resolve(row))} | ${SURFACES.map((s) => ratioOf({ fg: row, bg: s, min: 0 }).toFixed(2)).join(' | ')} |`,
    ),
    '',
    'Informational: a token is only held to a minimum on the surfaces listed below.',
    '',
    '### Checked pairs',
    '',
    '| Foreground | Background | Ratio | Minimum | Result |',
    '| --- | --- | --- | --- | --- |',
    ...results.map((r) => {
      const background = r.over ? `${name(r.bg)} over ${name(r.over)}` : name(r.bg);
      const result = r.reportOnly
        ? `reported only: ${r.reportOnly}`
        : r.ratio >= r.min
          ? 'pass'
          : '**fail**';
      return `| ${name(r.fg)} | ${background} | ${r.ratio.toFixed(2)} | ${r.min} | ${result} |`;
    }),
    '',
    '### Values copied out of tokens.css',
    '',
    '| Copy | Value | Must equal | Result |',
    '| --- | --- | --- | --- |',
    ...drift.map(
      (d) =>
        `| ${d.copy} | ${d.actual} | ${d.expected} | ${d.actual === d.expected ? 'match' : '**drift**'} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
