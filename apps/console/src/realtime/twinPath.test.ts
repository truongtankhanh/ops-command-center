/*
 * Two rules the 3D data path relies on (V2-14.11, ADR-0020 § State, docs/architecture.md § 5 "The 3D branch"),
 * stated as scans of the source so a later change cannot break them without a test saying which rule it breaks.
 * `twinFeed.test.ts` holds the behaviour (a buffer, a tick and a read touch no store); this holds the shape.
 *
 * Source text is read with Vite's `?raw`, as `twinBindings.test.ts` reads the docs. Comments are stripped first:
 * the files say "setState" in prose.
 */

// Vite names a file beside this one `./name` and every other `../dir/name`; the rules below spell every path the
// second way, so the first is brought to it (`./twinFeed.ts` → `../realtime/twinFeed.ts`).
const RAW = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Every non-test source file of the console, by path from this file (`../twin/useBoundParts.ts`). */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([path, text]) => [
    path.startsWith('./') ? `../realtime/${path.slice(2)}` : path,
    text,
  ]),
);

/** The code of a source file: block comments and line comments removed (a `//` after `:` is a URL, kept). */
function codeOf(path: string): string {
  const text = SOURCES[path];
  if (text === undefined) throw new Error(`${path} is not among the console's source files`);
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const pathsWhere = (keep: (path: string) => boolean): string[] =>
  Object.keys(SOURCES).filter(keep).sort();

describe('the targets path holds no React state', () => {
  // The modules the buffer passes through after the worker: the feed, the maths, the render loop and the painter.
  const PATH = [
    '../realtime/twinFeed.ts',
    '../lib/twinMotion.ts',
    '../twin/useBoundParts.ts',
    '../twin/useAssetLooks.ts',
  ];
  // Plain modules: not React, not three.
  const PLAIN = ['../realtime/twinFeed.ts', '../lib/twinMotion.ts'];

  it('finds the modules it is about', () => {
    for (const path of PATH) expect(SOURCES[path], path).toBeDefined();
    expect(pathsWhere((path) => path.startsWith('../twin/')).length).toBeGreaterThan(10);
  });

  it.each(PATH)('%s has no state hook and writes to no store', (path) => {
    const code = codeOf(path);

    expect(code).not.toMatch(/\buse(State|Reducer|SyncExternalStore)\b/);
    expect(code).not.toMatch(/\.setState\(/);
  });

  it.each(PLAIN)('%s is not a React or three module', (path) => {
    const code = codeOf(path);

    expect(code).not.toMatch(/from ['"](react|react-dom)['"]/);
    expect(code).not.toMatch(/from ['"](three|@react-three\/[\w-]+)['"]/);
  });

  // Reading the socket's status to snap after a reconnect (`useBoundParts`) is allowed: it subscribes, it does not write.
  it('keeps the one piece of React state of the 3D data path in the feed holder', () => {
    const code = codeOf('../twin/useTwinFeed.ts');

    // The holder holds the feed object, never a reading; a second use of state here is a decision to make.
    expect(code.match(/\buseState\(/g)).toHaveLength(1);
    expect(code).toMatch(/useState\(createHolder\)/);
    expect(code).not.toMatch(/\buseReducer\b/);
    expect(code).not.toMatch(/\.setState\(/);
  });
});

describe('the 3D side asks for no watch', () => {
  // Phase 4 Open question 11: the watch set is not widened for the 3D view or for building focus; V2-15 chooses
  // one on purpose. Whoever does that changes this test with the rule it breaks in view.
  const WATCH_API = /\b(useTelemetryWatch|setWatch)\b|telemetry\.watch/;

  it('is not in anything under src/twin/ or in the feed', () => {
    const paths = pathsWhere(
      (path) => path.startsWith('../twin/') || path === '../realtime/twinFeed.ts',
    );
    expect(paths.length).toBeGreaterThan(10);

    for (const path of paths) expect(codeOf(path), path).not.toMatch(WATCH_API);
  });

  it('has one owner of the set, TelemetryWatchSet, and one caller of the client, the hook', () => {
    // `useTelemetryWatch(` that is not the hook's own declaration.
    const setters = pathsWhere((path) => /(?<!function )\buseTelemetryWatch\(/.test(codeOf(path)));
    const clientCallers = pathsWhere((path) => /\.setWatch\(/.test(codeOf(path)));

    expect(setters).toEqual(['../components/TelemetryWatchSet.tsx']);
    expect(clientCallers).toEqual(['../realtime/useTelemetry.ts']);
  });
});
