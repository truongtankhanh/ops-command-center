/*
 * `pnpm models:check`: holds every `.glb` under `ops/models/` to the model contract (ADR-0020 § Budgets;
 * the rules and their numbers are in `rules.ts`). Run in CI before the tests and the build, so a model that
 * breaks a budget or the naming contract is stopped before it can be served.
 *
 * One line per failed rule, `ops/models/<file>: <rule>: <detail>`, then a summary; exit code 1 when anything
 * failed, 2 when the tool itself could not run (the catalogue cannot be read). A missing or empty directory
 * passes: the demo's models arrive with V2-13.3.
 *
 * The class list and each class's points come from the simulator's catalogue (`ops/telemetry-sim/
 * catalogue.json`, kept in step with the seed by a spec in the API): no second copy of either. Reading a
 * Meshopt-compressed file needs the decoder (WASM, no native binary).
 *
 * Not a workspace member and not linted; `pnpm models:typecheck` checks it, `pnpm models:test` tests it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { checkDirectoryEntry, checkFile, checkModel, readGlbJson, type Failure } from './rules.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const MODELS_DIR = join(REPO_ROOT, 'ops/models');
const CATALOGUE = join(REPO_ROOT, 'ops/telemetry-sim/catalogue.json');
/** How a file is named in the log. */
const LOG_PREFIX = 'ops/models/';

/** class code → the keys of its telemetry points */
export type ClassPoints = ReadonlyMap<string, ReadonlySet<string>>;

export interface FileFailure extends Failure {
  file: string;
}

export interface DirectoryReport {
  /** `.glb` files looked at. */
  checked: number;
  failures: FileFailure[];
}

interface CatalogueFile {
  assets?: { code?: string; classCode?: string; points?: { key?: string }[] }[];
}

/**
 * The points of each class, from the catalogue's assets. All assets of a class must list the same keys; if two
 * disagree the class's points are unknown, so this throws rather than guess.
 */
export function classPointsOf(catalogue: CatalogueFile): ClassPoints {
  const byClass = new Map<string, Set<string>>();
  for (const asset of catalogue.assets ?? []) {
    if (!asset.classCode) continue;
    const keys = new Set((asset.points ?? []).flatMap((point) => (point.key ? [point.key] : [])));
    const known = byClass.get(asset.classCode);
    if (!known) {
      byClass.set(asset.classCode, keys);
    } else if (known.size !== keys.size || [...keys].some((key) => !known.has(key))) {
      throw new Error(
        `the catalogue's assets of class "${asset.classCode}" do not list the same points (see ${asset.code ?? 'an asset'})`,
      );
    }
  }
  return byClass;
}

export async function loadClassPoints(path = CATALOGUE): Promise<ClassPoints> {
  return classPointsOf(JSON.parse(await readFile(path, 'utf8')) as CatalogueFile);
}

let io: NodeIO | undefined;
async function reader(): Promise<NodeIO> {
  if (!io) {
    await MeshoptDecoder.ready;
    io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  }
  return io;
}

/** Checks every entry of `dir`. A directory that does not exist has nothing to check. */
export async function checkDirectory(
  dir: string,
  classPoints: ClassPoints,
): Promise<DirectoryReport> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { checked: 0, failures: [] };
    throw error;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const classCodes = new Set(classPoints.keys());
  const failures: FileFailure[] = [];
  const add = (file: string, found: Failure[]) =>
    failures.push(...found.map((failure) => ({ file, ...failure })));
  let checked = 0;

  for (const entry of entries) {
    add(entry.name, checkDirectoryEntry(entry.name, entry.isDirectory()));
    if (!entry.isFile() || !entry.name.endsWith('.glb')) continue;
    checked++;

    const bytes = new Uint8Array(await readFile(join(dir, entry.name)));
    const { classCode, failures: fileFailures } = checkFile(entry.name, bytes, classCodes);
    add(entry.name, fileFailures);

    // The content is checked against the class the name claims; with no known class there is nothing to hold it to.
    if (classCode === null) continue;
    try {
      const json = readGlbJson(bytes);
      const document = await (await reader()).readBinary(bytes);
      const pointKeys = classPoints.get(classCode) ?? new Set<string>();
      add(entry.name, checkModel({ document, json, classCode, pointKeys }));
    } catch (error) {
      add(entry.name, [
        { rule: 'readable', detail: `cannot be read as glTF: ${(error as Error).message}` },
      ]);
    }
  }
  return { checked, failures };
}

export const formatFailure = ({ file, rule, detail }: FileFailure): string =>
  `${LOG_PREFIX}${file}: ${rule}: ${detail}`;

async function main(): Promise<number> {
  let classPoints: ClassPoints;
  try {
    classPoints = await loadClassPoints();
  } catch (error) {
    console.error(
      `models:check: cannot read the catalogue (${CATALOGUE}): ${(error as Error).message}`,
    );
    return 2;
  }

  const report = await checkDirectory(MODELS_DIR, classPoints);
  for (const failure of report.failures) console.error(formatFailure(failure));

  if (report.failures.length > 0) {
    console.error(
      `models:check: ${report.failures.length} failure(s) in ${report.checked} model file(s)`,
    );
    return 1;
  }
  console.log(
    report.checked === 0
      ? 'models:check: no models in ops/models, nothing to check'
      : `models:check: ${report.checked} model file(s) conform`,
  );
  return 0;
}

// Run as a command, not when the specs import it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
