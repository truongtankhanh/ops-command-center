import { HUD_LABEL, HUD_ROWS } from '../src/lib/twin-core/twinHud.ts';
import {
  BUDGET_BYTES,
  DEBUG_MARKERS,
  debugMarkerProblems,
  entryKeyOf,
  evaluate,
  graphProblems,
  gzipBytes,
  HEAVY_MARKERS,
  type Manifest,
  staticClosure,
  TWIN_SRC,
  twinFiles,
} from './chunk-budget.ts';

// A manifest as `vite build` writes it: keys are source paths (entries) or `_name` (shared chunks).
const manifest = (extra: Manifest = {}): Manifest => ({
  'index.html': {
    file: 'assets/index-a.js',
    css: ['assets/index-a.css'],
    isEntry: true,
    dynamicImports: [TWIN_SRC],
  },
  [TWIN_SRC]: {
    file: 'assets/TwinStage-b.js',
    css: ['assets/TwinStage-b.css'],
    isDynamicEntry: true,
    imports: ['index.html'],
  },
  ...extra,
});

describe('entryKeyOf', () => {
  it('prefers index.html, then any entry, and refuses a manifest without one', () => {
    expect(entryKeyOf(manifest())).toBe('index.html');
    expect(entryKeyOf({ 'main.ts': { file: 'a.js', isEntry: true } })).toBe('main.ts');
    expect(() => entryKeyOf({ x: { file: 'a.js' } })).toThrow('no entry chunk');
  });
});

describe('staticClosure', () => {
  it('follows static imports and never dynamic ones', () => {
    const closure = staticClosure(manifest(), 'index.html');

    expect([...closure]).toEqual(['index.html']);
    expect([...staticClosure(manifest(), TWIN_SRC)]).toEqual([TWIN_SRC, 'index.html']);
  });

  it('survives an import cycle', () => {
    const cyclic: Manifest = {
      a: { file: 'a.js', imports: ['b'] },
      b: { file: 'b.js', imports: ['a'] },
    };

    expect(new Set(staticClosure(cyclic, 'a'))).toEqual(new Set(['a', 'b']));
  });
});

describe('twinFiles', () => {
  it('is the twin chunk and its CSS when it imports only the entry', () => {
    expect(twinFiles(manifest(), TWIN_SRC, 'index.html')).toEqual([
      'assets/TwinStage-b.js',
      'assets/TwinStage-b.css',
    ]);
  });

  it('adds a shared chunk that only the twin imports', () => {
    const files = twinFiles(
      manifest({
        [TWIN_SRC]: {
          file: 'assets/TwinStage-b.js',
          isDynamicEntry: true,
          imports: ['index.html', '_three'],
        },
        _three: { file: 'assets/three-c.js', css: ['assets/three-c.css'] },
      }),
      TWIN_SRC,
      'index.html',
    );

    expect(files).toEqual(['assets/TwinStage-b.js', 'assets/three-c.js', 'assets/three-c.css']);
  });

  it('leaves out a chunk that the entry also reaches: it is the main bundle', () => {
    const files = twinFiles(
      manifest({
        'index.html': {
          file: 'assets/index-a.js',
          isEntry: true,
          imports: ['_react'],
          dynamicImports: [TWIN_SRC],
        },
        [TWIN_SRC]: {
          file: 'assets/TwinStage-b.js',
          isDynamicEntry: true,
          imports: ['index.html', '_react'],
        },
        _react: { file: 'assets/react-d.js' },
      }),
      TWIN_SRC,
      'index.html',
    );

    expect(files).toEqual(['assets/TwinStage-b.js']);
  });

  it('refuses a manifest without the twin chunk, so a renamed import cannot pass', () => {
    const withoutTwin = manifest();
    delete withoutTwin[TWIN_SRC];

    expect(() => twinFiles(withoutTwin, TWIN_SRC, 'index.html')).toThrow(TWIN_SRC);
  });
});

describe('graphProblems', () => {
  const none = () => '';

  it('is clean when the twin is only a dynamic import of a clean entry', () => {
    expect(graphProblems(manifest(), 'index.html', TWIN_SRC, none)).toEqual([]);
  });

  it('reports the twin chunk statically imported by the entry', () => {
    const problems = graphProblems(
      manifest({
        'index.html': {
          file: 'assets/index-a.js',
          isEntry: true,
          imports: [TWIN_SRC],
        },
      }),
      'index.html',
      TWIN_SRC,
      none,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('static import graph');
  });

  it('reports a static chunk that holds all the three.js markers, not one that holds some', () => {
    const read = (markers: readonly string[]) => () => markers.join(' ');

    expect(graphProblems(manifest(), 'index.html', TWIN_SRC, read(HEAVY_MARKERS))).toHaveLength(1);
    expect(
      graphProblems(manifest(), 'index.html', TWIN_SRC, read(HEAVY_MARKERS.slice(0, 2))),
    ).toEqual([]);
  });

  it('does not read the twin chunk (it has its own check) or a CSS file', () => {
    const read = vi.fn(() => HEAVY_MARKERS.join(' '));
    const twinInEntry = manifest({
      'index.html': {
        file: 'assets/index-a.js',
        css: ['assets/index-a.css'],
        isEntry: true,
        imports: [TWIN_SRC, '_style'],
      },
      _style: { file: 'assets/style.css' },
    });

    graphProblems(twinInEntry, 'index.html', TWIN_SRC, read);

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('assets/index-a.js');
  });
});

describe('evaluate', () => {
  const size = (gzip: number) => ({ file: 'assets/TwinStage-b.js', bytes: gzip * 4, gzip });

  it('is ok under the budget and says by how much', () => {
    const { ok, lines } = evaluate({ sizes: [size(240_000)], budget: BUDGET_BYTES, problems: [] });

    expect(ok).toBe(true);
    // Relative to the budget, so a change of the figure (ADR-0020) does not make this test say the old one.
    expect(lines.join('\n')).toContain(
      `${((BUDGET_BYTES - 240_000) / 1000).toFixed(2)} kB under the budget`,
    );
  });

  it('is ok at the budget exactly and fails one byte over, naming the excess', () => {
    expect(evaluate({ sizes: [size(BUDGET_BYTES)], budget: BUDGET_BYTES, problems: [] }).ok).toBe(
      true,
    );

    const over = evaluate({ sizes: [size(BUDGET_BYTES + 1)], budget: BUDGET_BYTES, problems: [] });
    expect(over.ok).toBe(false);
    expect(over.lines.join('\n')).toContain('over the budget by 0.00 kB');
  });

  it('adds the chunks of the twin together', () => {
    // Two chunks that are one byte over the budget together and under it alone, whatever the budget is.
    const { ok, lines } = evaluate({
      sizes: [
        size(200_000),
        { file: 'assets/three-c.js', bytes: 1, gzip: BUDGET_BYTES - 200_000 + 1 },
      ],
      budget: BUDGET_BYTES,
      problems: [],
    });

    expect(ok).toBe(false);
    expect(lines.join('\n')).toContain(
      `total ${((BUDGET_BYTES + 1) / 1000).toFixed(2)} kB (${BUDGET_BYTES + 1} B)`,
    );
  });

  it('fails on a structural problem even when the size is fine, and prints it', () => {
    const { ok, lines } = evaluate({
      sizes: [size(1000)],
      budget: BUDGET_BYTES,
      problems: ['the twin is static'],
    });

    expect(ok).toBe(false);
    expect(lines).toContain('FAIL: the twin is static');
  });
});

describe('gzipBytes', () => {
  it('is smaller than a repetitive input and the same for a string and its bytes', () => {
    const text = 'three.js '.repeat(1000);

    expect(gzipBytes(text)).toBeLessThan(text.length / 10);
    expect(gzipBytes(new TextEncoder().encode(text))).toBe(gzipBytes(text));
  });
});

describe('debugMarkerProblems', () => {
  it('is empty when the HUD is nowhere in the emitted files', () => {
    expect(
      debugMarkerProblems([
        { file: 'assets/index-a.js', code: 'const frame = "Frame"; const debug = 1;' },
        { file: 'assets/index-a.css', code: '.hud{display:grid}' },
      ]),
    ).toEqual([]);
  });

  it('names the file of a chunk that holds the address that switches the HUD on', () => {
    const problems = debugMarkerProblems([
      { file: 'assets/index-a.js', code: 'ok' },
      { file: 'assets/Hud-b.js', code: 'aria-label="Twin performance (debug=twin)"' },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('assets/Hud-b.js');
    expect(problems[0]).toContain('debug=twin');
  });

  it('finds a marker in a stylesheet too', () => {
    const problems = debugMarkerProblems([
      { file: 'assets/TwinStage-c.css', code: '/* Frame (p95) */' },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('assets/TwinStage-c.css');
  });

  it('gives one line for each marker found in a file', () => {
    expect(
      debugMarkerProblems([{ file: 'assets/x.js', code: 'debug=twin ... Frame (p95)' }]),
    ).toHaveLength(2);
  });

  it('looks for words the HUD really has, so renaming one fails here and not in a build', () => {
    expect(HUD_LABEL).toContain(DEBUG_MARKERS[0]);
    expect(HUD_ROWS.map(({ label }) => label)).toContain(DEBUG_MARKERS[1]);
  });
});
