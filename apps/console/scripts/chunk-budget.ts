/**
 * Budget for the 3D twin's lazy chunk (ADR-0020 § Lazy chunk), checked after `vite build`.
 *
 *   node scripts/chunk-budget.ts     run by `pnpm build`, right after `vite build`
 *
 * It reads `dist/.vite/manifest.json` (`build.manifest` in `vite.config.ts`), finds the dynamic entry of
 * `src/twin/TwinStage.tsx`, and adds up the gzip size of its chunk, its CSS and the chunks only it imports
 * (a chunk that the page's own static graph also reaches is the main bundle's, not the twin's). Exit 1 when
 * that is over `BUDGET_BYTES`, when the twin chunk is statically reachable from `index.html`, when a static
 * chunk looks like three.js, or when the manifest or the twin chunk is missing: a check that cannot run must
 * not pass. After a pass it deletes `dist/.vite/`, so the console image never serves the manifest.
 *
 * Units: a kilobyte is 1,000 bytes, as in Vite's reporter, and the size is zlib level 9 of the emitted files.
 * Vite's reporter prints about 1 % more for the same chunk (it uses its own compressor); this script is the
 * reference. Plain Node 24 with type stripping and no dependency, like `contrast.ts`; `scripts/` is outside
 * `tsc`, so the types here are for the reader and ESLint.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

/**
 * ADR-0020: 375 KB gzipped, three.js included (350 KB until V2-17.3, which raised it: "Amended in V2-17.3"). Change it
 * there first.
 */
export const BUDGET_BYTES = 375_000;

/** The manifest key of the twin's dynamic entry: the source path, relative to the console's root. */
export const TWIN_SRC = 'src/twin/TwinStage.tsx';

/**
 * Names that are in three.js and in nothing else the console bundles (MapLibre has neither the renderer
 * nor the scene graph). A chunk of the static graph that holds all three has pulled three.js out of the
 * lazy chunk. A heuristic on minified code: the structural check (`graphProblems`) is the guarantee.
 */
export const HEAVY_MARKERS = ['WebGLRenderer', 'BufferGeometry', 'Object3D'] as const;

/**
 * Text that only the developer HUD (V2-19.1) contains: its accessible name (`HUD_LABEL`, which holds the address
 * that switches it on) and the label of one of its rows. Neither is in shipped code, so either one in `dist` means the
 * development-only HUD reached a production build. `chunk-budget.test.ts` keeps them in step with the HUD's words
 * (`src/lib/twinHud.ts`).
 */
export const DEBUG_MARKERS = ['debug=twin', 'Frame (p95)'] as const;

/** The part of Vite's manifest this check reads (`ManifestChunk` in vite's types). */
export interface ManifestChunk {
  file: string;
  css?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  /** Keys of the chunks it imports statically. */
  imports?: string[];
  /** Keys of the chunks it imports with `import()`: never followed, that is the point of a lazy chunk. */
  dynamicImports?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

export interface ChunkSize {
  file: string;
  bytes: number;
  gzip: number;
}

export const gzipBytes = (content: Uint8Array | string): number =>
  gzipSync(content, { level: 9 }).length;

/** The key of the page's entry chunk: `index.html` when it is one, else the first entry. */
export function entryKeyOf(manifest: Manifest): string {
  if (manifest['index.html']?.isEntry) return 'index.html';
  const key = Object.keys(manifest).find((candidate) => manifest[candidate]?.isEntry);
  if (key === undefined) throw new Error('The manifest has no entry chunk.');
  return key;
}

/** `rootKey` and every chunk reachable from it through static `imports` only. */
export function staticClosure(manifest: Manifest, rootKey: string): Set<string> {
  const seen = new Set<string>();
  const pending = [rootKey];
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(...(manifest[key]?.imports ?? []));
  }
  return seen;
}

/**
 * The emitted files that belong to the twin: its chunk and CSS, and those of the chunks it imports that
 * the entry's own static graph does not reach. The twin chunk always counts, even if it is (wrongly) in
 * the entry's graph: `graphProblems` reports that.
 */
export function twinFiles(manifest: Manifest, twinKey: string, entryKey: string): string[] {
  if (!manifest[twinKey]) {
    throw new Error(
      `The manifest has no chunk for ${twinKey}: the lazy import of the twin is gone or was renamed.`,
    );
  }
  if (!manifest[entryKey]) throw new Error(`The manifest has no entry chunk ${entryKey}.`);
  const shared = staticClosure(manifest, entryKey);
  const files = new Set<string>();
  for (const key of staticClosure(manifest, twinKey)) {
    if (key !== twinKey && shared.has(key)) continue;
    const chunk = manifest[key];
    if (!chunk) continue;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
  }
  return [...files];
}

/**
 * What would make the 2D view download three.js: the twin chunk in the entry's static graph, or a static
 * chunk that holds all of `HEAVY_MARKERS`. `read` returns a chunk's code.
 */
export function graphProblems(
  manifest: Manifest,
  entryKey: string,
  twinKey: string,
  read: (file: string) => string,
): string[] {
  const problems: string[] = [];
  const closure = staticClosure(manifest, entryKey);
  if (closure.has(twinKey)) {
    problems.push(
      `${twinKey} is in the static import graph of ${entryKey}: the 2D view would download it.`,
    );
  }
  for (const key of closure) {
    const chunk = manifest[key];
    if (key === twinKey || !chunk?.file.endsWith('.js')) continue;
    const code = read(chunk.file);
    const found = HEAVY_MARKERS.filter((marker) => code.includes(marker));
    if (found.length === HEAVY_MARKERS.length) {
      problems.push(
        `${chunk.file} is statically loaded and holds ${found.join(', ')}: it looks like three.js (heuristic).`,
      );
    }
  }
  return problems;
}

/** One line for each marker found in each emitted file; none when the HUD is nowhere in `files`. */
export function debugMarkerProblems(files: readonly { file: string; code: string }[]): string[] {
  return files.flatMap(({ file, code }) =>
    DEBUG_MARKERS.filter((marker) => code.includes(marker)).map(
      (marker) =>
        `${file} contains "${marker}": the development-only HUD (V2-19.1) is in the production build.`,
    ),
  );
}

/** Every `.js` and `.css` under `dist/assets/`; throws when there is none, because a scan of nothing proves nothing. */
function readEmittedFiles(dist: URL): { file: string; code: string }[] {
  const assets = new URL('assets/', dist);
  const files = readdirSync(assets, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .map((name) => ({ file: `assets/${name}`, code: readFileSync(new URL(name, assets), 'utf8') }));
  if (files.length === 0) throw new Error('dist/assets has no .js or .css file to scan.');
  return files;
}

const kB = (bytes: number): string => `${(bytes / 1000).toFixed(2)} kB`;

/** The report, and whether the twin is within its budget with no structural problem. */
export function evaluate({
  sizes,
  budget,
  problems,
}: {
  sizes: readonly ChunkSize[];
  budget: number;
  problems: readonly string[];
}): { ok: boolean; lines: string[] } {
  const total = sizes.reduce((sum, size) => sum + size.gzip, 0);
  const lines = [
    'Twin chunk (gzip level 9; 1 kB = 1,000 bytes):',
    ...sizes.map(
      (size) => `  ${size.file}  ${kB(size.bytes)} raw  ${kB(size.gzip)} gzip (${size.gzip} B)`,
    ),
    `  total ${kB(total)} (${total} B) of a budget of ${kB(budget)} (${budget} B)`,
  ];
  const over = total > budget;
  lines.push(
    over
      ? `FAIL: over the budget by ${kB(total - budget)}. The budget is ADR-0020's to change.`
      : `ok: ${kB(budget - total)} under the budget.`,
  );
  for (const problem of problems) lines.push(`FAIL: ${problem}`);
  return { ok: !over && problems.length === 0, lines };
}

function main(): void {
  const dist = new URL('../dist/', import.meta.url);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8')) as Manifest;
  } catch {
    console.error(
      'chunk-budget: dist/.vite/manifest.json is missing. Run `vite build` first; `build.manifest` must be on.',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const entryKey = entryKeyOf(manifest);
    const sizes = twinFiles(manifest, TWIN_SRC, entryKey).map((file) => {
      const content = readFileSync(new URL(file, dist));
      return { file, bytes: content.length, gzip: gzipBytes(content) };
    });
    const problems = graphProblems(manifest, entryKey, TWIN_SRC, (file) =>
      readFileSync(new URL(file, dist), 'utf8'),
    );
    const { ok: withinBudget, lines } = evaluate({ sizes, budget: BUDGET_BYTES, problems });
    const emitted = readEmittedFiles(dist);
    const hudProblems = debugMarkerProblems(emitted);
    if (hudProblems.length === 0)
      lines.push(`ok: no developer HUD in ${emitted.length} emitted files.`);
    for (const problem of hudProblems) lines.push(`FAIL: ${problem}`);
    console.log(lines.join('\n'));
    if (!withinBudget || hudProblems.length > 0) {
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error(`chunk-budget: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  // Only after a pass: a failure keeps the manifest for diagnosis.
  rmSync(new URL('.vite/', dist), { recursive: true, force: true });
}

if (import.meta.main) main();
