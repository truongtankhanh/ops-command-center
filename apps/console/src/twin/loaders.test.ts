import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { DECODER_BASE_PATH } from '../../vite.decoders';
import { DECODER_BASE_URL, gltfLoaders, releaseGltfLoaders } from './loaders';

// WebGL does not exist here. `detectSupport` only asks the renderer which compressed formats it has.
const renderer = () =>
  ({ extensions: { has: () => false, get: () => undefined } }) as unknown as WebGLRenderer;

/** A glTF loader that records the KTX2 loader it is given. */
const gltfLoader = () => ({ setKTX2Loader: vi.fn() });

describe('the model loaders', () => {
  it('look for the transcoder where the build and the dev server put it', () => {
    expect(DECODER_BASE_URL).toBe(DECODER_BASE_PATH);
  });

  it('give the glTF loader a KTX2 loader on this origin that knows the renderer', () => {
    const loader = gltfLoader();

    gltfLoaders(renderer())(loader);

    expect(loader.setKTX2Loader).toHaveBeenCalledTimes(1);
    const ktx2 = loader.setKTX2Loader.mock.calls[0]?.[0] as KTX2Loader;
    expect(ktx2).toBeInstanceOf(KTX2Loader);
    expect(ktx2.transcoderPath).toBe('/decoders/basis/');
    // `detectSupport` ran: the formats of this renderer are known, none of them here.
    expect(ktx2.workerConfig).toMatchObject({ astcSupported: false, dxtSupported: false });
  });

  it('use one KTX2 loader for a renderer, however many models are loaded', () => {
    const gl = renderer();
    const first = gltfLoader();
    const second = gltfLoader();

    gltfLoaders(gl)(first);
    gltfLoaders(gl)(second);

    expect(second.setKTX2Loader.mock.calls[0]?.[0]).toBe(first.setKTX2Loader.mock.calls[0]?.[0]);
  });

  it('give another renderer its own', () => {
    const first = gltfLoader();
    const second = gltfLoader();

    gltfLoaders(renderer())(first);
    gltfLoaders(renderer())(second);

    expect(second.setKTX2Loader.mock.calls[0]?.[0]).not.toBe(
      first.setKTX2Loader.mock.calls[0]?.[0],
    );
  });

  describe('released with the stage (V2-19.6)', () => {
    /** The KTX2 loader `gltfLoaders` gave a glTF loader for `gl`. */
    function loaderOf(gl: WebGLRenderer): KTX2Loader {
      const loader = gltfLoader();
      gltfLoaders(gl)(loader);
      return loader.setKTX2Loader.mock.calls[0]?.[0] as KTX2Loader;
    }

    it('disposes a loader that has transcoded something, once, and a second release does nothing', () => {
      const gl = renderer();
      const ktx2 = loaderOf(gl);
      // What its first transcode sets: it holds a worker pool now.
      ktx2.transcoderPending = Promise.resolve();
      const dispose = vi.spyOn(ktx2, 'dispose').mockImplementation(() => undefined);

      releaseGltfLoaders(gl);
      releaseGltfLoaders(gl);

      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('only forgets a loader that never initialised: it holds nothing, and disposing it would unbalance three’s count', () => {
      const gl = renderer();
      const ktx2 = loaderOf(gl);
      const dispose = vi.spyOn(ktx2, 'dispose');

      releaseGltfLoaders(gl);

      expect(dispose).not.toHaveBeenCalled();
    });

    it('gives the next stage on the same renderer a new loader', () => {
      const gl = renderer();
      const first = loaderOf(gl);

      releaseGltfLoaders(gl);

      expect(loaderOf(gl)).not.toBe(first);
    });

    it('does nothing for a renderer that never had one', () => {
      expect(() => releaseGltfLoaders(renderer())).not.toThrow();
    });

    it('leaves another renderer’s loader alone', () => {
      const [one, other] = [renderer(), renderer()];
      loaderOf(one);
      const kept = loaderOf(other);
      kept.transcoderPending = Promise.resolve();
      const dispose = vi.spyOn(kept, 'dispose').mockImplementation(() => undefined);

      releaseGltfLoaders(one);

      expect(dispose).not.toHaveBeenCalled();
      expect(loaderOf(other)).toBe(kept);
    });
  });
});
