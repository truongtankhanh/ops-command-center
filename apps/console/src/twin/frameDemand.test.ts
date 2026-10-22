/*
 * Three rules about who asks the on-demand canvas for a frame (V2-19.2, ADR-0020 § Scene), stated as scans of the source
 * so that a later change cannot break them without a test saying which. `lib/twinPerf.test.ts` holds the table of
 * reasons (`needsFrame`) and `useBoundParts.test.ts` and `realtime/twinFeed.test.ts` the behaviour; this holds the shape:
 *
 * 1. Every file of the 3D code that calls `useFrame` or `invalidate` says, in a `Frame demand:` paragraph of its comments,
 *    why and when. The audit of V2-19.2 found no call that asks without a reason; the note is what keeps it so, because
 *    the next caller has to write one.
 * 2. No `useFrame` takes a positive priority: R3F then stops rendering the scene itself and the stage goes blank.
 * 3. The loops that keep the canvas drawing (`Rig`'s fly-to, `useBoundParts`, `Beacons`) run below priority 0, where
 *    `FrameDriver` reads what they wrote in the same frame, whatever the order in which they were mounted.
 *
 * Not a rule here, on purpose: "no `invalidate()` outside a condition". A scan of the code cannot tell a guarded call
 * from an unguarded one, and a pass that proves nothing is worse than no test.
 *
 * Source text is read with Vite's `?raw`, as `realtime/twinPath.test.ts` does. Comments are stripped for the questions
 * about code (the files say `invalidate` in prose) and kept for the note.
 */

// Vite names a file beside this one `./name` and every other `../dir/name`; every path below is spelled the second way.
const RAW = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Every non-test source file of the console, by path from this file (`../twin/Rig.tsx`). */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([path, text]) => [
    path.startsWith('./') ? `../twin/${path.slice(2)}` : path,
    text,
  ]),
);

/** The code of a piece of source: block comments and line comments removed (a `//` after `:` is a URL, kept). */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sourceOf(path: string): string {
  const text = SOURCES[path];
  if (text === undefined) throw new Error(`${path} is not among the console's source files`);
  return text;
}

/**
 * The arguments of every `useFrame(...)` call in `code`, as text. Commas and brackets inside the callback do not split
 * it: only a comma at the call's own depth does.
 */
function useFrameCalls(code: string): string[][] {
  const calls: string[][] = [];
  for (const match of code.matchAll(/\buseFrame\(/g)) {
    const args: string[] = [];
    let depth = 1;
    let start = match.index + match[0].length;
    for (let i = start; i < code.length; i += 1) {
      const char = code.charAt(i);
      if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) {
        depth -= 1;
        if (depth === 0) {
          args.push(code.slice(start, i).trim());
          break;
        }
      } else if (char === ',' && depth === 1) {
        args.push(code.slice(start, i).trim());
        start = i + 1;
      }
    }
    calls.push(args.filter((arg) => arg !== ''));
  }
  return calls;
}

/** The priority a `useFrame` call was given: `0` by default, the literal when it is one, `NaN` when it is not a number. */
function priorityOf(args: readonly string[]): number {
  const priority = args[1];
  if (priority === undefined) return 0;
  return /^-?\d+$/.test(priority) ? Number(priority) : Number.NaN;
}

/** The files that ask for frames: the 3D code and the feed, where the code (not the prose) says `useFrame` or `invalidate`. */
const FRAME_USERS = Object.keys(SOURCES)
  .filter((path) => path.startsWith('../twin/') || path === '../realtime/twinFeed.ts')
  .filter((path) => /\b(useFrame|invalidate)\b/.test(stripComments(sourceOf(path))))
  .sort();

describe('the helpers of this scan', () => {
  it('reads the arguments of a useFrame call, ignoring commas inside the callback', () => {
    const code = 'useFrame((state, delta) => { run(a, b); return [1, 2]; }, -1);';

    expect(useFrameCalls(code)).toEqual([
      ['(state, delta) => { run(a, b); return [1, 2]; }', '-1'],
    ]);
  });

  it('finds every call in a file, and none in prose-free code without one', () => {
    expect(useFrameCalls('useFrame(a); x(); useFrame(b, 2);')).toHaveLength(2);
    expect(useFrameCalls('const useFrameDemand = 1; invalidate();')).toEqual([]);
  });

  it('gives the priority: 0 by default, the literal, and NaN for anything else', () => {
    expect(priorityOf(['() => {}'])).toBe(0);
    expect(priorityOf(['() => {}', '-2'])).toBe(-2);
    expect(priorityOf(['() => {}', '3'])).toBe(3);
    expect(priorityOf(['() => {}', 'PRIORITY'])).toBeNaN();
  });
});

describe('who asks for frames', () => {
  it('finds the files that do (a scan that finds nothing would pass every rule below)', () => {
    for (const known of [
      '../twin/Rig.tsx',
      '../twin/Beacons.tsx',
      '../twin/useBoundParts.ts',
      '../twin/FrameDriver.tsx',
      '../twin/TwinCanvas.tsx',
      '../twin/TwinStage.tsx',
      '../realtime/twinFeed.ts',
    ]) {
      expect(FRAME_USERS, known).toContain(known);
    }
  });

  it('has a "Frame demand:" note in every file that calls useFrame or invalidate', () => {
    const missing = FRAME_USERS.filter((path) => !sourceOf(path).includes('Frame demand:'));

    expect(
      missing,
      'These files call useFrame or invalidate without saying why and when. Add a "Frame demand:" paragraph to the ' +
        'doc comment (see FrameDriver.tsx): a loop that keeps the canvas drawing reports through useFrameDemand; ' +
        'anything else is a one-shot after a change.',
    ).toEqual([]);
  });
});

describe('the priority of useFrame', () => {
  const calls = FRAME_USERS.flatMap((path) =>
    useFrameCalls(stripComments(sourceOf(path))).map((args) => ({
      path,
      priority: priorityOf(args),
    })),
  );

  it('finds the calls (a scan that finds none would pass the rules below)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(8);
  });

  it('is a literal number, and never positive: R3F would stop rendering the scene', () => {
    const bad = calls.filter(({ priority }) => !(priority <= 0)).map(({ path }) => path);

    expect(bad, 'A useFrame priority must be a literal number that is 0 or below.').toEqual([]);
  });

  // `Rig.tsx` has two loops, the fly-to and the pad's held move (V3-29); both run before `FrameDriver`.
  it.each([
    ['../twin/Rig.tsx', -2, 2],
    ['../twin/useBoundParts.ts', -1, 1],
    ['../twin/Beacons.tsx', -1, 1],
  ])(
    'runs the loop of %s below priority 0, so FrameDriver reads its flag in the same frame',
    (path, priority, count) => {
      const own = calls.filter((call) => call.path === path);

      expect(own).toHaveLength(count);
      expect(own.map((call) => call.priority)).toEqual(Array(count).fill(priority));
    },
  );

  it('keeps FrameDriver at the default priority, after the loops it reads', () => {
    const own = calls.filter((call) => call.path === '../twin/FrameDriver.tsx');

    expect(own).toEqual([{ path: '../twin/FrameDriver.tsx', priority: 0 }]);
  });
});
