import {
  BUDGET_BYTES,
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
    expect(lines.join('\n')).toContain('110.00 kB under the budget');
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
    const { ok, lines } = evaluate({
      sizes: [size(200_000), { file: 'assets/three-c.js', bytes: 1, gzip: 150_001 }],
      budget: BUDGET_BYTES,
      problems: [],
    });

    expect(ok).toBe(false);
    expect(lines.join('\n')).toContain('total 350.00 kB (350001 B)');
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
