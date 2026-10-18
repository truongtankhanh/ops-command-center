import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * Where the Basis transcoder is served from, in `pnpm dev` and in the image: the console's own origin, so
 * nothing is fetched from a third party (the console is on-prem; drei's defaults point at Google's and
 * jsDelivr's CDNs). `vite.decoders.ts` puts the files there at build time and in the dev server
 * (V2-13.5, ADR-0020 § Serving); its spec keeps this equal to `DECODER_BASE_PATH`. When a Content Security
 * Policy is added it must allow `'wasm-unsafe-eval'` and `worker-src 'self' blob:` (the loader runs the
 * transcoder in blob workers).
 */
export const DECODER_BASE_URL = '/decoders/basis/';

/**
 * The second and third arguments of drei's `useGLTF(url, useDraco, useMeshopt, extendLoader)`: Draco off,
 * because its decoder defaults to Google's CDN and models are Meshopt-only (`pnpm models:check`); Meshopt on,
 * which needs no file, because drei's `MeshoptDecoder` embeds its WebAssembly.
 */
export const MODEL_LOADER_FLAGS = { useDraco: false, useMeshopt: true } as const;

/**
 * The part of a glTF loader this module uses: three-stdlib's `GLTFLoader`, which drei's `useGLTF` builds, has
 * it. The parameter is `never` so that loader fits: three-stdlib declares its own `KTX2Loader` type, which is
 * not assignable to three's (its `dispose()` returns `this`, three's returns `void`), although the glTF
 * loader only uses the object through the `Loader` interface (`load`).
 */
interface KTX2Target {
  setKTX2Loader(loader: never): unknown;
}

// One loader per renderer: each KTX2Loader loads the transcoder and allocates workers, and three warns about
// several of them being active at once. Keyed by the renderer, so it goes with it.
const loaders = new WeakMap<WebGLRenderer, KTX2Loader>();

/**
 * The `extendLoader` argument of `useGLTF`: it gives the glTF loader a `KTX2Loader` that finds the
 * transcoder on this origin and knows which compressed formats `gl` supports. The `KTX2Loader` is made on the
 * first model that is loaded, not when this is called.
 *
 * It comes from `three/examples/jsm/loaders/KTX2Loader.js`: `three-stdlib`, where drei's loaders live, is not
 * a dependency of the console. Nothing calls this before V2-14.7 loads models into the scene, and the stand-in
 * models have no textures, so the transcoding itself is first exercised by the vendor's file (V2-13.8).
 */
export function gltfLoaders(gl: WebGLRenderer): (loader: KTX2Target) => void {
  return (loader) => {
    let ktx2 = loaders.get(gl);
    if (!ktx2) {
      ktx2 = new KTX2Loader().setTranscoderPath(DECODER_BASE_URL).detectSupport(gl);
      loaders.set(gl, ktx2);
    }
    (loader as { setKTX2Loader(loader: KTX2Loader): unknown }).setKTX2Loader(ktx2);
  };
}
