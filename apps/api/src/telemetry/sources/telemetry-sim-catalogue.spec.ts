import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_CLASSES } from '../database/seed/asset-catalogue';
import { ASSETS } from '../database/seed/assets';
import { SITE } from '../database/seed/campus';

/**
 * The device simulator of the `telemetry` Compose profile (V2-06.11, ADR-0019) lives outside this
 * app and cannot import it (ADR-0001: an app never imports another). It carries two copies, and
 * this spec is what keeps them honest:
 *
 * - `ops/telemetry-sim/catalogue.json`: the assets, the points of their class and the class rules,
 *   as the seed holds them. After a seed change, write `JSON.stringify(expectedCatalogue(), null, 2)`
 *   to that file and run `pnpm exec prettier --write` on it; the spec then passes.
 * - `ops/telemetry-sim/src/waveform.ts`: `mock-waveform.ts`, byte for byte, so the demo with
 *   `TELEMETRY_SOURCE=mqtt` shows the numbers the demo with `mock` shows.
 *
 * The broker's entrypoint lists the device accounts with `sed` over the catalogue file, so its
 * line layout is part of the contract too.
 */
const SIM_DIR = join(__dirname, '../../../../ops/telemetry-sim');
const read = (path: string): string => readFileSync(join(SIM_DIR, path), 'utf8');

function expectedCatalogue() {
  const classes = new Map(ASSET_CLASSES.map((assetClass) => [assetClass.code, assetClass]));
  return {
    site: SITE.code,
    assets: ASSETS.map((asset) => {
      const assetClass = classes.get(asset.class);
      if (!assetClass) throw new Error(`asset ${asset.code} has no class ${asset.class}`);
      return {
        code: asset.code,
        classCode: assetClass.code,
        points: assetClass.points.map((point) => ({
          key: point.key,
          kind: point.kind,
          min: point.min,
          max: point.max,
          enumValues: point.enumValues,
          expectedIntervalS: point.expectedIntervalS,
        })),
        rules: assetClass.rules.map((rule) => ({
          key: rule.key,
          comparator: rule.comparator,
          limit: rule.limit,
          clear: rule.clear,
        })),
      };
    }),
  };
}

describe('telemetry simulator copies', () => {
  it('has a catalogue that is what the seed holds: assets, class points and class rules', () => {
    expect(JSON.parse(read('catalogue.json'))).toEqual(expectedCatalogue());
  });

  it('has the site code the topics use', () => {
    expect(JSON.parse(read('catalogue.json')).site).toBe('LANGBIANG');
  });

  it('writes one "code" per asset and one "site", each on a line of its own, for the broker', () => {
    const lines = read('catalogue.json').split('\n');
    const codes = lines.flatMap((line) => /^\s*"code":\s*"([A-Za-z0-9_-]+)"/.exec(line)?.[1] ?? []);
    const sites = lines.flatMap((line) => /^\s*"site":\s*"([A-Za-z0-9_-]+)"/.exec(line)?.[1] ?? []);

    expect(codes).toEqual(ASSETS.map((asset) => asset.code));
    expect(sites).toEqual([SITE.code]);
  });

  it("has a waveform that is the mock source's, byte for byte", () => {
    expect(read('src/waveform.ts')).toBe(readFileSync(join(__dirname, 'mock-waveform.ts'), 'utf8'));
  });
});
