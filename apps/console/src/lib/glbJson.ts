import type { NodeInfo } from './twinBindings';

/*
 * What the console can know about a model without loading it (V2-14.10, ADR-0020 § Model contract): the node
 * tree and the `extras` of a `.glb`, read from its JSON chunk. Pure, with no `three`: the inspector and the
 * incident sheet read parts in the 2D view and in the WebGL-less fallback, which must never download the 3D
 * chunk. A `.glb` is a 12-byte header (magic `glTF`, version, total length) and then chunks, each an 8-byte
 * header (length, type) and its data; the first chunk is the JSON, padded with spaces to 4 bytes, and a binary
 * chunk follows it.
 */

const MAGIC = 0x46546c67; // "glTF", little-endian
const VERSION = 2;
const JSON_CHUNK = 0x4e4f534a; // "JSON", little-endian
/** The header and the first chunk's header: where the JSON starts. */
const JSON_START = 20;

/** How much of a file the first read asks for: more than a model's JSON needs (a stand-in's is about 5 KB). */
export const FIRST_READ_BYTES = 65_536;

/**
 * The largest JSON chunk the console reads, in bytes. A model is at most 1.5 MB in all (`pnpm models:check`), so
 * a header that claims more is wrong or hostile, and is refused before anything is asked for.
 */
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

export interface GlbHeader {
  /** Where the JSON chunk ends in the file: the number of bytes to read to have all of it. */
  jsonEnd: number;
}

/**
 * Checks the magic, the version and that the first chunk is JSON, and says where it ends. Needs the first 20
 * bytes of the file; anything else throws, naming what is wrong.
 */
export function readGlbHeader(bytes: Uint8Array): GlbHeader {
  if (bytes.length < JSON_START) throw new Error('not a GLB: the file is too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB: bad magic');
  const version = view.getUint32(4, true);
  if (version !== VERSION) throw new Error(`not a GLB the console reads: version ${version}`);
  if (view.getUint32(16, true) !== JSON_CHUNK) {
    throw new Error('not a GLB the console reads: the first chunk is not JSON');
  }
  return { jsonEnd: JSON_START + view.getUint32(12, true) };
}

/** A glTF document, as far as the console reads it: unchecked, so every field is `unknown` until used. */
export type GltfJson = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The glTF JSON of a buffer that holds the whole JSON chunk (it may hold more: the binary chunk after it is
 * not read). Throws when the chunk is cut short, does not parse, or is not an object.
 */
export function readGlbJson(bytes: Uint8Array): GltfJson {
  const { jsonEnd } = readGlbHeader(bytes);
  if (bytes.length < jsonEnd) throw new Error('not a GLB: the JSON chunk is cut short');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(JSON_START, jsonEnd)));
  } catch {
    throw new Error('not a GLB the console reads: the JSON chunk does not parse');
  }
  if (!isRecord(json))
    throw new Error('not a GLB the console reads: the JSON chunk is not an object');
  return json;
}

const nameOf = (node: unknown): string =>
  isRecord(node) && typeof node.name === 'string' ? node.name : '';

/**
 * The class root of a model as a `NodeInfo` (V2-14.2's input): the first node of the default scene whose name
 * does not end `_LOD1` (the LOD sibling is not a part), with its children in order and each node's `extras` as
 * the file has them. A node reached twice is followed once; an unnamed node has the name `''`. `null` when
 * the scene has no such root.
 */
export function nodeInfos(json: GltfJson): NodeInfo | null {
  const nodes = Array.isArray(json.nodes) ? (json.nodes as unknown[]) : [];
  const scenes = Array.isArray(json.scenes) ? (json.scenes as unknown[]) : [];
  const scene = scenes[typeof json.scene === 'number' ? json.scene : 0];
  const roots = isRecord(scene) && Array.isArray(scene.nodes) ? (scene.nodes as unknown[]) : [];

  const followed = new Set<number>();
  const infoOf = (index: unknown): NodeInfo | null => {
    if (typeof index !== 'number' || !Number.isInteger(index) || followed.has(index)) return null;
    const node = nodes[index];
    if (!isRecord(node)) return null;
    followed.add(index);
    const children = (Array.isArray(node.children) ? (node.children as unknown[]) : [])
      .map(infoOf)
      .filter((child): child is NodeInfo => child !== null);
    return {
      name: nameOf(node),
      ...(node.extras === undefined ? {} : { extras: node.extras }),
      children,
    };
  };

  for (const index of roots) {
    if (typeof index === 'number' && nameOf(nodes[index]).endsWith('_LOD1')) continue;
    const root = infoOf(index);
    if (root !== null) return root;
  }
  return null;
}

/** What `fetchGlbJson` needs of `fetch`; the default is the global one, looked up when it is called. */
type Fetcher = (input: string, init: { headers: Record<string, string> }) => Promise<Response>;

const globalFetch: Fetcher = (input, init) => fetch(input, init);

async function readRange(
  url: string,
  bytes: number,
  fetcher: Fetcher,
): Promise<{ bytes: Uint8Array; status: number }> {
  const response = await fetcher(url, { headers: { Range: `bytes=0-${bytes - 1}` } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status };
}

/**
 * The glTF JSON of the model at `url`, with as little downloaded as the server allows (ADR-0020 § Serving: the
 * files are public and immutable). One request asks for the first `FIRST_READ_BYTES` with a `Range` header: nginx
 * answers `206` with them, the Vite dev server ignores `Range` and answers `200` with the whole file, and either
 * has the JSON of a small model. When the JSON chunk is longer than that, a second request asks for exactly its
 * bytes (a server that answers `200` again gives the whole file, which is read the same way).
 *
 * Throws, naming the cause, on an HTTP error, a file that is not a GLB, a chunk above `MAX_JSON_BYTES` or a body
 * shorter than its header says.
 */
export async function fetchGlbJson(url: string, fetcher: Fetcher = globalFetch): Promise<GltfJson> {
  const first = await readRange(url, FIRST_READ_BYTES, fetcher);
  const { jsonEnd } = readGlbHeader(first.bytes);
  if (jsonEnd > MAX_JSON_BYTES) {
    throw new Error(
      `${url}: the JSON chunk is ${jsonEnd} bytes, more than the ${MAX_JSON_BYTES} read`,
    );
  }
  if (first.bytes.length >= jsonEnd) return readGlbJson(first.bytes);
  // A whole file shorter than its own header says is damaged; a partial answer is asked for the rest.
  if (first.status !== 206) throw new Error(`${url}: the file is shorter than its header says`);
  return readGlbJson((await readRange(url, jsonEnd, fetcher)).bytes);
}
