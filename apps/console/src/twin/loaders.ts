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
 * The part of a glTF loader this module uses: three's own `GLTFLoader` (`loadGltf.ts`, V2-14.7) has it.
 */
interface KTX2Target {
  setKTX2Loader(loader: KTX2Loader): unknown;
}

// One loader per renderer: each KTX2Loader loads the transcoder and allocates workers, and three warns about
// several of them being active at once. Keyed by the renderer, so it goes with it.
const loaders = new WeakMap<WebGLRenderer, KTX2Loader>();

/**
 * Gives a glTF loader a `KTX2Loader` that finds the transcoder on this origin and knows which compressed
 * formats `gl` supports. The `KTX2Loader` is made for the first model that is loaded, not when this is called.
 *
 * `loadGltf.ts` calls it for every model, with three's `GLTFLoader` and Meshopt (which needs no file: the
 * decoder embeds its WebAssembly) and without Draco, whose decoder defaults to a CDN and which the models do
 * not use (`pnpm models:check`). The stand-in models have no textures, so the transcoding itself is first
 * exercised by the vendor's file (V2-13.8).
 */
export function gltfLoaders(gl: WebGLRenderer): (loader: KTX2Target) => void {
  return (loader) => {
    let ktx2 = loaders.get(gl);
    if (!ktx2) {
      ktx2 = new KTX2Loader().setTranscoderPath(DECODER_BASE_URL).detectSupport(gl);
      loaders.set(gl, ktx2);
    }
    loader.setKTX2Loader(ktx2);
  };
}
