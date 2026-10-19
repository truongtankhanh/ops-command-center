import type { Object3D, WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gltfLoaders } from './loaders';

/** Bytes received so far and in all; `total` is `0` when the server did not say (no `Content-Length`). */
export interface BytesProgress {
  loaded: number;
  total: number;
}

/**
 * Fetches and parses one model file (V2-14.7): three's `GLTFLoader` with the Meshopt decoder, which embeds
 * its WebAssembly and needs no file, and the KTX2 transcoder from this origin (`loaders.ts`); no Draco, whose
 * decoder defaults to a CDN and which the models do not use (`pnpm models:check`). It resolves with the
 * glTF's scene (the class root and its `_LOD1` sibling), and rejects on a network error, a 404 or a file the
 * parser or a decoder refuses.
 *
 * This is the one place a model touches the network, and it is not unit-tested: it needs one and a GL
 * context. The model cache takes it as a parameter, so everything built on it is tested with a fake.
 */
export function loadGltf(
  url: string,
  gl: WebGLRenderer,
  onProgress: (progress: BytesProgress) => void,
): Promise<Object3D> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  gltfLoaders(gl)(loader);
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      (event) =>
        onProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : 0 }),
      reject,
    );
  });
}
