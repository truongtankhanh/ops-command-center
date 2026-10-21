/*
 * Renders the sign-in page's backdrop (V2-20.3, brief § Sign-in, frame 19): a stylised, unlabelled campus seen
 * from the south-east, turning slowly, as a short looping video and a poster that is its first frame.
 *
 * The scene is invented here. It is not exported from a site plan or from the demo seed: the page is public
 * and carries no label, camera, incident, asset or reading (ADR-0010, "Settled in V2-20.1"). The palette is a
 * copy of the twin's neutrals in `apps/console/src/styles/tokens.css` (`--tw-*`), so the backdrop reads as the
 * same campus the console draws. How to run it, and the camera path, are in `ops/keycloak/themes/occ/BACKDROP.md`.
 *
 *   node ops/sign-in-backdrop/render.ts            video and poster into the theme's img folder
 *   node ops/sign-in-backdrop/render.ts --poster   the poster only (a second, for looking at the scene)
 *
 * No dependency: a small even-odd scanline rasteriser draws the polygons, and `ffmpeg` and `cwebp` (both on the
 * PATH) encode the result. Frames are streamed to `ffmpeg`, so memory stays at one frame.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Rgb = readonly [number, number, number];
type Vec3 = readonly [number, number, number];
type Pt = readonly [number, number];

const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// A copy of the console's twin neutrals (tokens.css). Only neutrals: severity is the one loud colour.
const GROUND = hex('#0f1d27'); // --tw-ground
const ROAD = hex('#182a36'); // --tw-road
const TOP = hex('#2a4658'); // --tw-top
const EDGE = hex('#3e5a6e'); // --tw-edge
const STEEL_TOP = hex('#435766'); // --tw-steel-top
// A cooler stand-in for `--tw-concrete-top` (#363c41), which reads brown beside the blues of everything else.
const ROOF_ALT = hex('#324b5c');
const WALL_DARK = hex('#121f2b'); // a little under --tw-east: faces turned away from the key light
const WALL_LIGHT = hex('#24404f'); // a little over --tw-south: faces turned to it
const LAWN = hex('#122632');
const PLAZA = hex('#1a2e3b');
const WATER = hex('#0b161e');
const TREE_TOP = hex('#1e3847');

// Frame sizes: the video is 16:9 and the poster is the same picture larger. 2 × 2 supersampling.
const VIDEO = { w: 1280, h: 720 };
const POSTER = { w: 1920, h: 1080 };
const SS = 2;
const FPS = 24;
// The page puts a 55 % shade over the backdrop, so the picture is rendered a little brighter than the tokens.
const GAIN = 1.25;

// Camera path (brief: yaw 30°, pitch 58°, 2° a second). The yaw sweeps 30° → 50° → 10° → 30° at a constant
// 2° a second, so the loop closes on the frame it starts from, in position and in direction.
const YAW_CENTRE_DEG = 30;
const YAW_SWEEP_DEG = 20;
const DEG_PER_SECOND = 2;
const LOOP_SECONDS = (4 * YAW_SWEEP_DEG) / DEG_PER_SECOND; // 40 s
const TILT_DEG = 58; // from vertical
const FOV_DEG = 30;
const DISTANCE_M = 490;
const TARGET: Vec3 = [0, -16, 6];

/** Yaw in degrees at `t` seconds. */
function yawAt(t: number): number {
  const u = t % LOOP_SECONDS;
  const quarter = LOOP_SECONDS / 4;
  const d = u < quarter ? u : u < 3 * quarter ? 2 * quarter - u : u - 4 * quarter;
  return YAW_CENTRE_DEG + d * DEG_PER_SECOND;
}

// ---- The scene (metres, x east, y north, z up) -------------------------------------------------------------

interface Prism {
  pts: Pt[]; // footprint, counter-clockwise seen from above
  z0: number;
  h: number;
  top: Rgb;
  floors: boolean;
  cx: number;
  cy: number;
}
interface Flat {
  pts: Pt[];
  color: Rgb;
}
interface Stroke {
  a: Pt;
  b: Pt;
  width: number;
  color: Rgb;
}

function rect(cx: number, cy: number, w: number, d: number, angleDeg = 0): Pt[] {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (
    [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ] as const
  ).map(([x, y]): Pt => [cx + x * c - y * s, cy + x * s + y * c]);
}
function ngon(cx: number, cy: number, r: number, n: number): Pt[] {
  return Array.from({ length: n }, (_, i): Pt => {
    const a = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}
function prism(
  pts: Pt[],
  h: number,
  top: Rgb = TOP,
  opts: { z0?: number; floors?: boolean } = {},
): Prism {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { pts, z0: opts.z0 ?? 0, h, top, floors: opts.floors ?? true, cx, cy };
}

/** A small deterministic generator, so the same frames come out every time. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildScene(): { flats: Flat[]; strokes: Stroke[]; prisms: Prism[] } {
  const flats: Flat[] = [];
  const strokes: Stroke[] = [];
  const prisms: Prism[] = [];

  // Ground: a big lawn inside a ring road, with the entrance road, a plaza and the paths.
  flats.push({ pts: rect(0, 0, 320, 200), color: LAWN });
  const ring = (cx: number, cy: number, w: number, d: number, t: number) => {
    flats.push({ pts: rect(cx, cy - d / 2, w + t, t), color: ROAD });
    flats.push({ pts: rect(cx, cy + d / 2, w + t, t), color: ROAD });
    flats.push({ pts: rect(cx - w / 2, cy, t, d + t), color: ROAD });
    flats.push({ pts: rect(cx + w / 2, cy, t, d + t), color: ROAD });
  };
  ring(0, 0, 300, 180, 10);
  flats.push({ pts: rect(0, -140, 12, 100), color: ROAD }); // the entrance road, from the south
  flats.push({ pts: rect(0, -30, 90, 40), color: PLAZA });
  flats.push({ pts: rect(0, 6, 6, 160), color: PLAZA }); // the spine path
  flats.push({ pts: rect(0, 30, 280, 6), color: PLAZA }); // the cross path
  // The lake, a blob in the north-east corner.
  const lake: Pt[] = Array.from({ length: 28 }, (_, i): Pt => {
    const a = (2 * Math.PI * i) / 28;
    const r = 1 + 0.18 * Math.sin(3 * a + 0.6) + 0.1 * Math.sin(5 * a);
    return [110 + 42 * r * Math.cos(a), 58 + 20 * r * Math.sin(a)];
  });
  flats.push({ pts: lake, color: WATER });
  // The sports field: a running track around a pitch, in the west.
  const track: Pt[] = Array.from({ length: 40 }, (_, i): Pt => {
    const a = (2 * Math.PI * i) / 40;
    return [-100 + 40 * Math.cos(a), -8 + 24 * Math.sin(a)];
  });
  flats.push({ pts: track, color: ROAD });
  flats.push({ pts: rect(-100, -8, 56, 30), color: LAWN });
  strokes.push({ a: [-100, -23], b: [-100, 7], width: 0.5, color: PLAZA });
  // Two car parks in the south-east, with their bays.
  for (const [px, py] of [
    [78, -118],
    [118, -118],
  ] as const) {
    flats.push({ pts: rect(px, py, 34, 40), color: ROAD });
    for (let i = -7; i <= 7; i++) {
      strokes.push({
        a: [px + i * 2.2, py - 14],
        b: [px + i * 2.2, py - 4],
        width: 0.35,
        color: PLAZA,
      });
      strokes.push({
        a: [px + i * 2.2, py + 4],
        b: [px + i * 2.2, py + 14],
        width: 0.35,
        color: PLAZA,
      });
    }
  }

  // Buildings, all invented: a central hall, two laboratory wings, a tower, a library, three dormitories, a
  // sports hall, a utility plant with two cooling towers and a gatehouse.
  prisms.push(prism(rect(0, 4, 74, 34), 24));
  prisms.push(prism(rect(0, 4, 30, 14), 7, STEEL_TOP, { z0: 24, floors: false }));
  prisms.push(prism(rect(-92, 52, 56, 26), 18));
  prisms.push(prism(rect(-92, 52, 20, 12), 5, ROOF_ALT, { z0: 18, floors: false }));
  prisms.push(prism(rect(92, 10, 54, 26), 18));
  prisms.push(prism(rect(-48, -48, 26, 26), 38));
  prisms.push(prism(rect(-48, -48, 12, 12), 6, STEEL_TOP, { z0: 38, floors: false }));
  prisms.push(prism(rect(52, -52, 44, 30), 14));
  for (const x of [-60, -10, 40]) prisms.push(prism(rect(x, 74, 38, 15), 21));
  prisms.push(prism(rect(-118, -52, 46, 32), 16, ROOF_ALT));
  prisms.push(prism(rect(118, -52, 30, 22), 10, ROOF_ALT));
  prisms.push(prism(ngon(110, -66, 6.5, 14), 13, STEEL_TOP, { floors: false }));
  prisms.push(prism(ngon(126, -66, 6.5, 14), 13, STEEL_TOP, { floors: false }));
  prisms.push(prism(rect(14, -77, 10, 8), 5, ROOF_ALT));

  // Trees in rows along the ring road and the entrance road, and around the lake, kept off the buildings.
  const rand = rng(20);
  const rows: [number, number, number, number][] = [
    [-132, -78, 132, -78],
    [-132, 78, 132, 78],
    [-132, -78, -132, 78],
    [132, -78, 132, 78],
    [-8, -190, -8, -92],
    [8, -190, 8, -92],
  ];
  const clear = (x: number, y: number) =>
    !prisms.some((q) => q.h > 8 && Math.hypot(q.cx - x, q.cy - y) < 22) &&
    !(x > 62 && x < 164 && y > 30 && y < 88); // the lake
  const plant = (x: number, y: number) => {
    if (!clear(x, y)) return;
    prisms.push(
      prism(ngon(x, y, 2.2 + rand() * 1.4, 8), 4.5 + rand() * 3, TREE_TOP, { floors: false }),
    );
  };
  for (const [x0, y0, x1, y1] of rows) {
    const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 13));
    for (let i = 0; i <= n; i++) {
      plant(
        x0 + ((x1 - x0) * i) / n + (rand() - 0.5) * 3,
        y0 + ((y1 - y0) * i) / n + (rand() - 0.5) * 3,
      );
    }
  }
  for (let i = 0; i < 16; i++) {
    plant(110 + 58 * Math.cos((2 * Math.PI * i) / 16), 58 + 30 * Math.sin((2 * Math.PI * i) / 16));
  }
  return { flats, strokes, prisms };
}

// ---- Camera and rasteriser ---------------------------------------------------------------------------------

interface Cam {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  f: number;
  w: number;
  h: number;
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

function camera(yawDeg: number, w: number, h: number): Cam {
  const yaw = (yawDeg * Math.PI) / 180;
  const tilt = (TILT_DEG * Math.PI) / 180;
  const pos: Vec3 = [
    TARGET[0] + DISTANCE_M * Math.sin(tilt) * Math.sin(yaw),
    TARGET[1] - DISTANCE_M * Math.sin(tilt) * Math.cos(yaw),
    TARGET[2] + DISTANCE_M * Math.cos(tilt),
  ];
  const fwd = norm(sub(TARGET, pos));
  const right = norm(cross(fwd, [0, 0, 1]));
  const up = cross(right, fwd);
  return { pos, right, up, fwd, f: h / 2 / Math.tan((FOV_DEG * Math.PI) / 360), w, h };
}

function project(c: Cam, p: Vec3): Pt {
  const v = sub(p, c.pos);
  const z = dot(v, c.fwd);
  return [
    (c.w * SS) / 2 + (c.f * SS * dot(v, c.right)) / z,
    (c.h * SS) / 2 - (c.f * SS * dot(v, c.up)) / z,
  ];
}

/** Even-odd scanline fill, so convex and concave polygons both work. */
function fill(buf: Uint8ClampedArray, w: number, h: number, pts: readonly Pt[], color: Rgb): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(h - 1, Math.floor(maxY - 0.5));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i]! - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[i + 1]! - 0.5));
      for (let x = xa; x <= xb; x++) {
        const o = (y * w + x) * 3;
        buf[o] = color[0];
        buf[o + 1] = color[1];
        buf[o + 2] = color[2];
      }
    }
  }
}

function line(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  a: Pt,
  b: Pt,
  width: number,
  color: Rgb,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (width / 2);
  const ny = (dx / l) * (width / 2);
  fill(
    buf,
    w,
    h,
    [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ],
    color,
  );
}

// ---- One frame ---------------------------------------------------------------------------------------------

const KEY_LIGHT: readonly [number, number] = (() => {
  const l = Math.hypot(-0.92, -0.38);
  return [-0.92 / l, -0.38 / l]; // towards the light, from the west-south-west
})();

function fog(c: Cam, color: Rgb, x: number, y: number): Rgb {
  const d = Math.hypot(x - c.pos[0], y - c.pos[1], 0 - c.pos[2]);
  return mix(color, GROUND, Math.min(1, Math.max(0, (d - 380) / 300)) * 0.45);
}

function renderFrame(
  scene: ReturnType<typeof buildScene>,
  yawDeg: number,
  size: { w: number; h: number },
): Uint8Array {
  const cam = camera(yawDeg, size.w, size.h);
  const W = size.w * SS;
  const H = size.h * SS;
  const buf = new Uint8ClampedArray(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = GROUND[0];
    buf[i * 3 + 1] = GROUND[1];
    buf[i * 3 + 2] = GROUND[2];
  }
  const P = (p: Pt, z = 0) => project(cam, [p[0], p[1], z]);

  for (const f of scene.flats) {
    const cx = f.pts.reduce((s, p) => s + p[0], 0) / f.pts.length;
    const cy = f.pts.reduce((s, p) => s + p[1], 0) / f.pts.length;
    fill(
      buf,
      W,
      H,
      f.pts.map((p) => P(p)),
      fog(cam, f.color, cx, cy),
    );
  }
  for (const s of scene.strokes)
    line(buf, W, H, P(s.a), P(s.b), s.width * 3 * SS, fog(cam, s.color, s.a[0], s.a[1]));

  const order = scene.prisms
    .map((p) => ({
      p,
      d: Math.hypot(p.cx - cam.pos[0], p.cy - cam.pos[1], p.z0 + p.h / 2 - cam.pos[2]),
    }))
    .sort((a, b) => b.d - a.d);
  for (const { p } of order) {
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      const a = p.pts[i]!;
      const b = p.pts[(i + 1) % n]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nx = (b[1] - a[1]) / len;
      const ny = -(b[0] - a[0]) / len;
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, p.z0 + p.h / 2];
      if (dot([nx, ny, 0], sub(cam.pos, mid)) <= 0) continue;
      const t = (nx * KEY_LIGHT[0] + ny * KEY_LIGHT[1] + 1) / 2;
      const wall = fog(cam, mix(WALL_DARK, WALL_LIGHT, t), p.cx, p.cy);
      fill(buf, W, H, [P(a, p.z0), P(b, p.z0), P(b, p.z0 + p.h), P(a, p.z0 + p.h)], wall);
      if (p.floors) {
        const dark = mix(wall, GROUND, 0.45);
        for (let z = p.z0 + 3.6; z < p.z0 + p.h - 1; z += 3.6)
          line(buf, W, H, P(a, z), P(b, z), 0.5 * SS * 1.4, dark);
      }
    }
    const top = fog(cam, p.top, p.cx, p.cy);
    const roof = p.pts.map((q) => P(q, p.z0 + p.h));
    fill(buf, W, H, roof, top);
    if (p.floors || p.h > 8) {
      const edge = fog(cam, EDGE, p.cx, p.cy);
      for (let i = 0; i < n; i++) line(buf, W, H, roof[i]!, roof[(i + 1) % n]!, 0.7 * SS, edge);
    }
  }

  // Down to the frame's size, with a soft vignette that settles the corners.
  const out = new Uint8Array(size.w * size.h * 3);
  for (let y = 0; y < size.h; y++) {
    for (let x = 0; x < size.w; x++) {
      const nx = (x + 0.5) / size.w - 0.5;
      const ny = (y + 0.5) / size.h - 0.5;
      const v = 1 - 0.28 * Math.min(1, (nx * nx + ny * ny) * 2.4);
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < SS; dy++)
          for (let dx = 0; dx < SS; dx++) sum += buf[((y * SS + dy) * W + x * SS + dx) * 3 + c]!;
        out[(y * size.w + x) * 3 + c] = Math.min(255, Math.round((sum / (SS * SS)) * v * GAIN));
      }
    }
  }
  return out;
}

// ---- Encoding ----------------------------------------------------------------------------------------------

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status ?? r.signal})`);
}

async function writeVideo(scene: ReturnType<typeof buildScene>, file: string): Promise<void> {
  const crf = process.env['BACKDROP_CRF'] ?? '30';
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'fatal',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${VIDEO.w}x${VIDEO.h}`,
      '-r',
      String(FPS),
      '-i',
      '-',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      crf,
      '-pix_fmt',
      'yuv420p',
      '-deadline',
      'good',
      '-cpu-used',
      '2',
      '-row-mt',
      '1',
      '-threads',
      '2',
      '-g',
      String(FPS * 10),
      '-an',
      file,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<void>((ok, fail) => {
    ff.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))));
    ff.on('error', fail);
  });
  const frames = LOOP_SECONDS * FPS;
  for (let i = 0; i < frames; i++) {
    const frame = renderFrame(scene, yawAt(i / FPS), VIDEO);
    if (!ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 120 === 0) console.log(`frame ${i} of ${frames}`);
  }
  ff.stdin.end();
  await done;
}

function writePoster(scene: ReturnType<typeof buildScene>, file: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'occ-backdrop-'));
  try {
    const png = join(dir, 'poster.png');
    const frame = renderFrame(scene, yawAt(0), POSTER);
    const ff = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'fatal',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-s',
        `${POSTER.w}x${POSTER.h}`,
        '-i',
        '-',
        png,
      ],
      { input: frame, stdio: ['pipe', 'inherit', 'inherit'] },
    );
    if (ff.status !== 0) throw new Error('ffmpeg could not write the poster');
    run('cwebp', [
      '-quiet',
      '-q',
      process.env['BACKDROP_POSTER_Q'] ?? '90',
      '-m',
      '6',
      png,
      '-o',
      file,
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const img = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../keycloak/themes/occ/login/resources/img',
);
mkdirSync(img, { recursive: true });
const scene = buildScene();
writePoster(scene, join(img, 'campus-poster.webp'));
console.log('poster written');
if (!process.argv.includes('--poster')) {
  await writeVideo(scene, join(img, 'campus-loop.webm'));
  console.log('video written');
}
