import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { DECODER_BASE_PATH } from '../../vite.decoders';
import { DECODER_BASE_URL, gltfLoaders } from './loaders';

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
});
