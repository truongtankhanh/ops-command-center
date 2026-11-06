/**
 * SPIKE (V3-11.5, branch `spike/V3-11-realism-slice`, never merged): writes the realism slice's placeholder textures
 * into `public/environment/`, from where Vite copies them to `dist` and nginx serves them after the twin chunk
 * (decision Q1 of the analysis). Run by hand, once:
 *
 *   node apps/console/scripts/slice-textures.ts
 *
 * Every texture is 1024² (V3-13.1's placeholder size) and **greyscale detail**: the slice's materials keep their
 * token colour and multiply it by the texture, so the ground and the shells still read as their tokens. The look is
 * not the point; the cost is (fetch bytes, GPU memory, sampling). Seeded, so a rerun writes the same pixels.
 *
 * No dependency: PNG is written here with `node:zlib`, then converted with `cwebp` (on the `PATH`, as
 * `ops/sign-in-backdrop/render.ts` already needs).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const SIZE = 1024;
const QUALITY = '85';

type Shade = (x: number, y: number) => number;

/** A deterministic hash of a lattice point, in [0, 1). */
function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise that tiles with `period` cells across the texture, so a repeated texture shows no seam. */
function tiledNoise(period: number, seed: number): Shade {
  return (x, y) => {
    const fx = (x / SIZE) * period;
    const fy = (y / SIZE) * period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (i: number, j: number) => hash(i % period, j % period, seed);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

/** Octaves of `tiledNoise`, normalised to [0, 1]. */
function fractal(basePeriod: number, octaves: number, seed: number): Shade {
  const layers = Array.from({ length: octaves }, (_, o) =>
    tiledNoise(basePeriod * 2 ** o, seed + o),
  );
  const total = layers.reduce((sum, _, o) => sum + 0.5 ** o, 0);
  return (x, y) => layers.reduce((sum, layer, o) => sum + layer(x, y) * 0.5 ** o, 0) / total;
}

/** `value` between `low` and `high`. */
const span = (value: number, low: number, high: number) => low + (high - low) * value;

/** Whether `(x, y)` is within `width` pixels of a line of a grid `step` pixels apart. */
const onGrid = (v: number, step: number, width: number) => v % step < width;

const lawn: Shade = (() => {
  const blades = fractal(64, 3, 11);
  const patches = fractal(4, 2, 12);
  return (x, y) => span(blades(x, y) * 0.6 + patches(x, y) * 0.4, 0.78, 1);
})();

const asphalt: Shade = (() => {
  const grit = fractal(128, 3, 21);
  const wear = fractal(8, 2, 22);
  return (x, y) => span(grit(x, y) * 0.5 + wear(x, y) * 0.5, 0.82, 1);
})();

/** Paving slabs: a texture repeat is 8 m (the ground material's tile), so 8 × 8 slabs of 1 m. */
const paving: Shade = (() => {
  const grain = fractal(64, 2, 31);
  const step = SIZE / 8;
  return (x, y) => (onGrid(x, step, 6) || onGrid(y, step, 6) ? 0.72 : span(grain(x, y), 0.88, 1));
})();

/** Concrete panels: 2 × 2 per repeat, with joints and a low-frequency stain. */
const concrete: Shade = (() => {
  const stain = fractal(4, 3, 41);
  const step = SIZE / 2;
  return (x, y) => (onGrid(x, step, 4) || onGrid(y, step, 4) ? 0.7 : span(stain(x, y), 0.84, 1));
})();

const ground: Shade = (() => {
  const soft = fractal(8, 3, 51);
  return (x, y) => span(soft(x, y), 0.86, 1);
})();

/**
 * The facade atlas: 2 × 2 cells of 512², laid out as `sliceFacades.ts`'s `CELLS` (texture `v` grows upwards, image
 * rows grow downwards): glass top-left, louvred top-right, brick bottom-left, blank bottom-right. One cell is one bay
 * of one storey.
 */
const facades: Shade = (() => {
  const cell = SIZE / 2;
  const grain = fractal(32, 2, 61);
  const glass: Shade = (x, y) => {
    // Mullions at the cell's edges and a transom at a third; the pane dark.
    const mullion = x < 14 || x > cell - 14 || y < 18 || Math.abs(y - cell / 3) < 6;
    return mullion ? 0.95 : span(grain(x, y), 0.42, 0.55);
  };
  const louvred: Shade = (_x, y) => (y % 32 < 12 ? 0.62 : 0.9);
  const brick: Shade = (x, y) => {
    // A punched window in the middle of the bay, brick courses round it.
    const window = x > cell * 0.28 && x < cell * 0.72 && y > cell * 0.3 && y < cell * 0.78;
    if (window) return 0.4;
    const row = Math.floor(y / 24);
    const offset = row % 2 === 0 ? 0 : 32;
    const mortar = y % 24 < 3 || (x + offset) % 64 < 3;
    return mortar ? 0.97 : span(grain(x, y), 0.78, 0.9);
  };
  return (x, y) => {
    const left = x < cell;
    const top = y < cell;
    const lx = x % cell;
    const ly = y % cell;
    if (top) return left ? glass(lx, ly) : louvred(lx, ly);
    return left ? brick(lx, ly) : 1;
  };
})();

const TEXTURES: Record<string, Shade> = { lawn, asphalt, paving, concrete, ground, facades };

/** An 8-bit RGB PNG of `shade`, greyscale written as three equal channels. */
function png(shade: Shade): Buffer {
  const row = SIZE * 3 + 1;
  const raw = Buffer.alloc(row * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * row] = 0; // filter: none
    for (let x = 0; x < SIZE; x += 1) {
      const value = Math.round(Math.min(1, Math.max(0, shade(x, y))) * 255);
      raw.fill(value, y * row + 1 + x * 3, y * row + 1 + x * 3 + 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/environment');
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'slice-textures-'));
try {
  for (const [name, shade] of Object.entries(TEXTURES)) {
    const source = join(scratch, `${name}.png`);
    const target = join(out, `${name}.webp`);
    writeFileSync(source, png(shade));
    const run = spawnSync('cwebp', ['-quiet', '-q', QUALITY, '-m', '6', source, '-o', target], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (run.status !== 0) throw new Error(`cwebp could not write ${name}.webp`);
    // The texture's GPU memory, uncompressed RGBA with mipmaps (V3-11.1: w × h × 4 × 4/3).
    const gpu = Math.round(SIZE * SIZE * 4 * (4 / 3));
    console.log(`${name}.webp ${statSync(target).size} B on disk, ~${gpu} B on the GPU`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
