import nginxConf from './nginx.conf?raw';
import {
  contentTypeOf,
  DECODER_BASE_PATH,
  DECODER_CACHE_CONTROL,
  DECODER_FILES,
  DECODER_OUT_DIR,
  decoderSpecifier,
  isModelName,
  matchDevRequest,
  MODEL_CACHE_CONTROL,
  resolveDecoderSources,
} from './vite.decoders';

// One list of names for every copy of the rule: this module's, and nginx's in `nginx.conf` (V2-13.4).
const VALID_NAMES = [
  'cooling_tower.961e8f9f464e.glb',
  'standby_generator.f37bf7611883.glb',
  'a.000000000000.glb',
  'x1_y2.abcdef012345.glb',
];
const INVALID_NAMES = [
  'Cooling.961e8f9f464e.glb', // upper-case class
  'cooling_tower.961E8F9F464E.glb', // upper-case hex
  'cooling_tower.961e8f9f464.glb', // 11 hex
  'cooling_tower.961e8f9f464e0.glb', // 13 hex
  'cooling_tower.961e8f9f464e.gltf',
  'cooling_tower.961e8f9f464e.glb.bak',
  'cooling_tower.961e8f9f464e.glb/',
  '1cool.961e8f9f464e.glb', // starts with a digit
  '.961e8f9f464e.glb', // no class
  '../cooling_tower.961e8f9f464e.glb',
  'a/b.961e8f9f464e.glb',
  'README.md',
  '',
];

describe('the decoder files', () => {
  it('are the two files the Basis transcoder loader fetches, from three', () => {
    expect([...DECODER_FILES]).toEqual(['basis_transcoder.js', 'basis_transcoder.wasm']);
    expect(decoderSpecifier('basis_transcoder.wasm')).toBe(
      'three/examples/jsm/libs/basis/basis_transcoder.wasm',
    );
  });

  it('go to the folder the served URL names', () => {
    expect(`/${DECODER_OUT_DIR}/`).toBe(DECODER_BASE_PATH);
  });
});

describe('resolveDecoderSources', () => {
  it('returns each file with the path the resolver gave, in order', () => {
    const sources = resolveDecoderSources((specifier) => `/node_modules/${specifier}`);

    expect(sources).toEqual([
      {
        file: 'basis_transcoder.js',
        path: '/node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',
      },
      {
        file: 'basis_transcoder.wasm',
        path: '/node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
      },
    ]);
  });

  it('fails with a message that names the file, the cause and what to change when one has moved', () => {
    const missing = new Error('not found');
    const resolve = (specifier: string) => {
      if (specifier.endsWith('.wasm')) throw missing;
      return specifier;
    };

    let thrown: unknown;
    try {
      resolveDecoderSources(resolve);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as Error;
    expect(error.message).toContain('three/examples/jsm/libs/basis/basis_transcoder.wasm');
    expect(error.message).toMatch(/three upgrade/);
    expect(error.message).toContain('DECODER_FILES');
    expect(error.cause).toBe(missing);
  });
});

describe('the model name rule', () => {
  it.each(VALID_NAMES)('accepts %s', (name) => {
    expect(isModelName(name)).toBe(true);
  });

  it.each(INVALID_NAMES)('refuses %j', (name) => {
    expect(isModelName(name)).toBe(false);
  });

  // `apps/console/nginx.conf` serves `/models/` with a quoted regex (V2-13.4): the same names must pass
  // and fail there, or `pnpm dev` would serve what the image refuses.
  describe('against the regex in nginx.conf', () => {
    const line = /location\s+~\s+"([^"]*\/models\/[^"]*)"/.exec(nginxConf);
    const nginx = line?.[1] ? new RegExp(line[1]) : null;

    it('is found in nginx.conf', () => {
      expect(nginx, 'no `location ~ "…/models/…"` line in nginx.conf').not.toBeNull();
    });

    it.each(VALID_NAMES)('accepts %s too', (name) => {
      expect(nginx?.test(`/models/${name}`)).toBe(true);
    });

    it.each(INVALID_NAMES)('refuses %j too', (name) => {
      expect(nginx?.test(`/models/${name}`)).toBe(false);
    });
  });
});

describe('matchDevRequest', () => {
  it('names the decoder files under /decoders/basis/', () => {
    expect(matchDevRequest('/decoders/basis/basis_transcoder.js')).toEqual({
      kind: 'decoder',
      file: 'basis_transcoder.js',
    });
    expect(matchDevRequest('/decoders/basis/basis_transcoder.wasm')).toEqual({
      kind: 'decoder',
      file: 'basis_transcoder.wasm',
    });
  });

  it('answers 404 for any other name under /decoders/, and for the folder itself', () => {
    for (const url of [
      '/decoders/basis/other.js',
      '/decoders/basis/',
      '/decoders/',
      '/decoders/basis_transcoder.js',
      '/decoders/basis/../basis/basis_transcoder.js',
    ]) {
      expect(matchDevRequest(url), url).toEqual({ kind: 'not-found' });
    }
  });

  it('names a model whose file name follows the rule', () => {
    expect(matchDevRequest('/models/cooling_tower.961e8f9f464e.glb')).toEqual({
      kind: 'model',
      name: 'cooling_tower.961e8f9f464e.glb',
    });
  });

  it('answers 404 for a name that fails the rule, for the folder, and for a README', () => {
    for (const url of [
      '/models/cooling_tower.000.glb',
      '/models/',
      '/models/README.md',
      '/models/../models/cooling_tower.961e8f9f464e.glb',
      '/models/%2e%2e/cooling_tower.961e8f9f464e.glb',
      '/models/cooling_tower.961e8f9f464e.glb/',
    ]) {
      expect(matchDevRequest(url), url).toEqual({ kind: 'not-found' });
    }
  });

  it('ignores a query string and a fragment', () => {
    expect(matchDevRequest('/models/cooling_tower.961e8f9f464e.glb?v=1')).toEqual({
      kind: 'model',
      name: 'cooling_tower.961e8f9f464e.glb',
    });
    expect(matchDevRequest('/decoders/basis/basis_transcoder.wasm?x#y')).toEqual({
      kind: 'decoder',
      file: 'basis_transcoder.wasm',
    });
  });

  it('leaves every other URL to Vite', () => {
    for (const url of [
      '/',
      '/models',
      '/decoders',
      '/assets/x.js',
      '/api/incidents',
      '/@vite/client',
    ]) {
      expect(matchDevRequest(url), url).toBeNull();
    }
  });
});

describe('contentTypeOf', () => {
  it('gives the WebAssembly, script and model types, as nginx does in the image', () => {
    expect(contentTypeOf('basis_transcoder.wasm')).toBe('application/wasm');
    expect(contentTypeOf('basis_transcoder.js')).toBe('text/javascript');
    expect(contentTypeOf('cooling_tower.961e8f9f464e.glb')).toBe('model/gltf-binary');
    expect(contentTypeOf('notes.txt')).toBe('application/octet-stream');
  });
});

describe('the cache headers', () => {
  it('make a model immutable and a decoder revalidated, as nginx does', () => {
    expect(MODEL_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
    expect(DECODER_CACHE_CONTROL).toBe('no-cache');
  });
});
