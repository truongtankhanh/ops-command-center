import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_CLASSES, SUPERSEDED_MODEL_KEYS } from './asset-catalogue';

/**
 * The seed names a model file for each modelled class (`ClassSeed.modelKey`), and the API serves it
 * as `/models/<key>` (ADR-0020). The files are in `ops/models/`, outside this app (ADR-0001), and
 * the API image does not have them, so this spec is what keeps the seed's string equal to a file
 * that is committed. A typo would ship a `modelUrl` that is a `404`; a regenerated stand-in (a new
 * name, `pnpm models:standins`) fails here until the seed names it.
 */
const MODELS_DIR = join(__dirname, '../../../../../ops/models');
const NAME = (code: string) => new RegExp(`^${code}\\.[0-9a-f]{12}\\.glb$`);

const HOW_TO_FIX =
  'Name the committed file in the seed (asset-catalogue.ts) and put the name it replaces in ' +
  'SUPERSEDED_MODEL_KEYS first, so a volume that holds it moves on.';

/** Jest has no message argument: the failure prints what was checked, and what to do about it. */
const holds = (what: string, ok: boolean) =>
  expect({ [what]: ok, fix: HOW_TO_FIX }).toEqual({ [what]: true, fix: HOW_TO_FIX });

const MODELLED = ASSET_CLASSES.filter(({ modelKey }) => modelKey !== null);

describe('the seed model keys', () => {
  it('belong to the classes that have a model in ops/models', () => {
    expect(MODELLED.map(({ code }) => code)).toEqual(['cooling_tower', 'standby_generator']);
  });

  it.each(MODELLED.map(({ code, modelKey }) => [code, modelKey!] as const))(
    'name a file that is committed, with its own hash: %s',
    (code, key) => {
      holds(`${key} follows <class>.<12 hex>.glb`, NAME(code).test(key));

      const path = join(MODELS_DIR, key);
      holds(`${key} is in ops/models`, existsSync(path));

      // `<class>.<first 12 hex of the file's SHA-256>.glb`: the name is the file's content address.
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
      holds(`${key} carries the hash of its file (${hash})`, key.split('.')[1] === hash);
    },
  );

  it('leave no file of a modelled class that the seed does not name', () => {
    // A second `<class>.*.glb` beside the current one means the stand-in was regenerated and the
    // old file was not deleted (`pnpm models:standins` lists it as stale).
    const present = readdirSync(MODELS_DIR);
    for (const { code, modelKey } of MODELLED) {
      const allowed = new Set([modelKey, ...(SUPERSEDED_MODEL_KEYS[code] ?? [])]);
      const unnamed = present.filter((name) => NAME(code).test(name) && !allowed.has(name));
      holds(
        `ops/models has no ${code} file the seed does not name (${unnamed.join(', ')})`,
        unnamed.length === 0,
      );
    }
  });

  it('list superseded keys only for classes of the seed, in the class name pattern, never the current key', () => {
    const codes = new Set(ASSET_CLASSES.map(({ code }) => code));
    for (const [code, keys] of Object.entries(SUPERSEDED_MODEL_KEYS)) {
      holds(`SUPERSEDED_MODEL_KEYS names ${code}, a seed class`, codes.has(code));
      const current = ASSET_CLASSES.find((assetClass) => assetClass.code === code)?.modelKey;
      for (const key of keys) {
        holds(`${key} (superseded for ${code}) differs from the current key`, key !== current);
        holds(
          `${key} (superseded for ${code}) follows the class name pattern`,
          NAME(code).test(key),
        );
      }
    }
  });
});
