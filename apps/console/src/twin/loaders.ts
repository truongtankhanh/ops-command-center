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
// several of them being active at once. Keyed by the renderer, so the object goes with it; its workers do not
// (`releaseGltfLoaders`): every switch to 2D and back makes a new renderer, and with it a new loader.
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

/**
 * Releases the renderer's `KTX2Loader` when its stage goes (V2-19.6). A loader that has transcoded a texture holds a
 * pool of workers, the transcoder's binary and a blob URL, none of which the garbage collector frees: `dispose()` does.
 * Without it a model with KTX2 textures would leave all three behind on every switch to 2D and back, and three would warn
 * that several loaders are active.
 *
 * **Only a loader that initialised is disposed** (`transcoderPending` is set by its first transcode): `dispose()`
 * decrements three's module-level count of active loaders, which only initialising increments, so disposing one that never
 * started (every demo model: the stand-ins have no textures) would make that count wrong and hide a real second loader. It
 * holds nothing, so it is only forgotten. No loader for this renderer, or a second call, does nothing. Call it after the
 * models are done with (`useClassModels` does, once the cache is disposed): a parse in flight then is ignored by the cache.
 */
export function releaseGltfLoaders(gl: WebGLRenderer): void {
  const ktx2 = loaders.get(gl);
  if (ktx2 === undefined) return;
  loaders.delete(gl);
  if (ktx2.transcoderPending !== null) ktx2.dispose();
}
