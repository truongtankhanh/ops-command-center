/*
 * What the console serves besides its own code, as pure decisions (V2-13.5, ADR-0020 § Serving): the Basis
 * transcoder that KTX2 textures need, and the 3D models. `vite.config.ts` does the file system and the HTTP
 * (the `occ-decoders` plugin); everything it must get right is here, so `vite.decoders.test.ts` can check it
 * without a server.
 *
 * - **Build:** the transcoder is copied from the installed three into `dist/decoders/basis/` (the
 *   image then serves it at `/decoders/basis/…`, with `application/wasm` for the `.wasm`), and the build
 *   fails with a message that says what to do if a three upgrade moved it. It is copied from `node_modules`
 *   so it always matches the installed three.js, and nothing is fetched from a third party (the console
 *   is on-prem; drei's defaults point at Google's and jsDelivr's CDNs).
 * - **`pnpm dev`:** the same transcoder at the same URL, and `/models/<name>` from `ops/models/`, because
 *   Vite's dev server has no nginx in front of it. Only names the rule below accepts are served, and a name
 *   is the only thing ever joined to a directory, never the raw URL.
 * - **Meshopt needs no file:** drei's `MeshoptDecoder` (three-stdlib) embeds its WebAssembly. Draco is not
 *   shipped: models are Meshopt-only (`pnpm models:check`).
 *
 * No Node import and no Vite import on purpose. Not linted (root files are not; neither is `vite.config.ts`);
 * `tsc --noEmit` checks it (`tsconfig.json` `include`).
 */

/** The URL the transcoder is served under, in `pnpm dev` and in the image; `KTX2Loader.setTranscoderPath` takes it. */
export const DECODER_BASE_PATH = '/decoders/basis/';

/** Where those files go in `dist`: `DECODER_BASE_PATH` without the leading slash. */
export const DECODER_OUT_DIR = 'decoders/basis';

/** The files `KTX2Loader` fetches from the transcoder path: the loader script, then the WebAssembly it starts. */
export const DECODER_FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'] as const;
export type DecoderFile = (typeof DECODER_FILES)[number];

/**
 * A decoder's path through three's `exports` map (`./examples/jsm/*`). `three/package.json` is not exported,
 * so the package's folder cannot be found any other way.
 */
export const decoderSpecifier = (file: DecoderFile): string =>
  `three/examples/jsm/libs/basis/${file}`;

export interface DecoderSource {
  file: DecoderFile;
  /** The file on disk, as `resolve` returned it. */
  path: string;
}

/**
 * Finds every decoder file with `resolve` (the plugin passes Node's `require.resolve`) and turns a failure
 * into one error that says what moved and what to change: "the build fails with a clear message if a decoder
 * source moved in a three upgrade" is the alarm for exactly that.
 */
export function resolveDecoderSources(resolve: (specifier: string) => string): DecoderSource[] {
  return DECODER_FILES.map((file) => {
    const specifier = decoderSpecifier(file);
    try {
      return { file, path: resolve(specifier) };
    } catch (cause) {
      throw new Error(
        `Cannot find ${specifier}. The console copies the Basis transcoder from the installed three ` +
          `into dist/decoders/ (ADR-0020); a three upgrade may have moved or renamed it. ` +
          `Check node_modules/three/examples/jsm/libs/ and update DECODER_FILES in vite.decoders.ts.`,
        { cause },
      );
    }
  });
}

/**
 * A model's file name: `<class>.<12 hex>.glb` (ADR-0020 § Serving). The same rule as the regex in
 * `nginx.conf` and `FILE_NAME` in `ops/model-tools/rules.ts`; `vite.decoders.test.ts` runs one list of names
 * through this and through nginx's, so a difference shows there.
 */
export const MODEL_NAME = /^[a-z][a-z0-9_]*\.[0-9a-f]{12}\.glb$/;
export const isModelName = (name: string): boolean => MODEL_NAME.test(name);

/** A request the dev server answers itself. */
export type DevRequest =
  | { kind: 'decoder'; file: DecoderFile }
  | { kind: 'model'; name: string }
  /** Under `/decoders/` or `/models/` but not something served: a 404, never Vite's page for an unknown path. */
  | { kind: 'not-found' };

const DECODERS_PREFIX = '/decoders/';
const MODELS_PREFIX = '/models/';

const isDecoderFile = (name: string): name is DecoderFile =>
  (DECODER_FILES as readonly string[]).includes(name);

/**
 * What the dev server does with a URL (`req.url`): the decoder or model it names, a 404 for anything else
 * under `/decoders/` or `/models/`, and `null` for every other URL, which Vite handles as before. The query
 * string is ignored and nothing is decoded, so an encoded `..` is just a name that fails the rule.
 */
export function matchDevRequest(url: string): DevRequest | null {
  const end = url.search(/[?#]/);
  const pathname = end === -1 ? url : url.slice(0, end);

  if (pathname.startsWith(DECODERS_PREFIX)) {
    const file = pathname.startsWith(DECODER_BASE_PATH)
      ? pathname.slice(DECODER_BASE_PATH.length)
      : '';
    return isDecoderFile(file) ? { kind: 'decoder', file } : { kind: 'not-found' };
  }
  if (pathname.startsWith(MODELS_PREFIX)) {
    const name = pathname.slice(MODELS_PREFIX.length);
    return isModelName(name) ? { kind: 'model', name } : { kind: 'not-found' };
  }
  return null;
}

/** The `Content-Type` of a served file, as nginx's `mime.types` and `nginx.conf` give it in the image. */
export function contentTypeOf(fileName: string): string {
  if (fileName.endsWith('.wasm')) return 'application/wasm';
  if (fileName.endsWith('.js')) return 'text/javascript';
  if (fileName.endsWith('.glb')) return 'model/gltf-binary';
  return 'application/octet-stream';
}

/** A model's name carries its hash, so the file under a name never changes: immutable, as in `nginx.conf`. */
export const MODEL_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** The decoders' names are not hashed, so they are revalidated, as nginx's catch-all does. */
export const DECODER_CACHE_CONTROL = 'no-cache';
