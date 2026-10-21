/*
 * Measures the brightest the sign-in backdrop gets once the page's shade is over it (V2-20.7), so the contrast
 * pairs for the tagline and the foot in `apps/console/scripts/contrast.ts` rest on a number anyone can repeat.
 *
 *   node ops/sign-in-backdrop/measure.ts
 *
 * It decodes one frame a second of the loop and the poster with `ffmpeg`, puts the page's shade
 * (`rgb(12 24 33 / 0.55)`, the ground colour at 55 %) over every pixel it looks at, and reports the brightest
 * result anywhere and in the bottom tenth, where the foot stands, with the ratio of the three text tokens on each.
 * It also prints the short SHA-256 of both files: `MEASURED_BACKDROP` in contrast.ts holds them, so lint fails when
 * the picture is remade without this being run again.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const IMG = new URL('../keycloak/themes/occ/login/resources/img/', import.meta.url);
const LOOP = new URL('campus-loop.webm', IMG);
const POSTER = new URL('campus-poster.webp', IMG);

// The page's shade, and the text tokens it is read with (tokens.css).
const SHADE = [12, 24, 33] as const;
const SHADE_ALPHA = 0.55;
const TEXT: Record<string, string> = {
  '--text-primary': '#e4edf3',
  '--text-secondary': '#a6b8c5',
  '--text-tertiary': '#91a5b4',
};

type Rgb = readonly [number, number, number];

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const fromHex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Raw RGB frames of `file`, `width` × `height`, one a second (the poster is a single frame). */
function frames(file: URL, width: number, height: number): Buffer {
  const r = spawnSync(
    'ffmpeg',
    [
      '-v',
      'fatal',
      '-i',
      file.pathname,
      '-vf',
      `fps=1,scale=${width}:${height}`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg could not read ${file.pathname}`);
  return r.stdout;
}

let anywhere: { l: number; c: Rgb } | undefined;
let band: { l: number; c: Rgb } | undefined;

function scan(data: Buffer, width: number, height: number): void {
  const size = width * height * 3;
  for (let f = 0; f + size <= data.length; f += size) {
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const o = f + (y * width + x) * 3;
        const c = [0, 1, 2].map(
          (i) => (1 - SHADE_ALPHA) * data[o + i]! + SHADE_ALPHA * SHADE[i]!,
        ) as unknown as Rgb;
        const l = luminance(c);
        if (anywhere === undefined || l > anywhere.l) anywhere = { l, c };
        if (y > 0.9 * height && (band === undefined || l > band.l)) band = { l, c };
      }
    }
  }
}

scan(frames(LOOP, 1280, 720), 1280, 720);
scan(frames(POSTER, 1920, 1080), 1920, 1080);

const sha = (file: URL) =>
  createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);

for (const [label, spot] of [
  ['anywhere', anywhere],
  ['bottom tenth', band],
] as const) {
  if (!spot) throw new Error('no pixels read');
  console.log(`brightest ${label}: ${toHex(spot.c)}`);
  for (const [token, hex] of Object.entries(TEXT)) {
    console.log(`  ${token} ${ratio(fromHex(hex), spot.c).toFixed(2)}`);
  }
}
console.log(`MEASURED_BACKDROP = { poster: '${sha(POSTER)}', loop: '${sha(LOOP)}' }`);
