import {
  FIRST_READ_BYTES,
  fetchGlbJson,
  MAX_JSON_BYTES,
  nodeInfos,
  readGlbHeader,
  readGlbJson,
} from './glbJson';

/** A `.glb` as the spec lays it out: header, a JSON chunk padded with spaces, then a binary chunk. */
function glb(
  json: unknown,
  { magic = 0x46546c67, version = 2, firstChunk = 0x4e4f534a, bin = 8 } = {},
): Uint8Array {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  const body = new TextEncoder().encode(text);
  const jsonLength = Math.ceil(body.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + bin;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, firstChunk, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(body, 20);
  view.setUint32(20 + jsonLength, bin, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  return bytes;
}

const MODEL = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0, 3] }],
  nodes: [
    { name: 'Tower', children: [1, 2] },
    { name: 'Fan', extras: { bind: 'fanSpeedRpm', motion: 'spin' } },
    { name: 'Casing' },
    { name: 'Tower_LOD1' },
  ],
};

describe('readGlbHeader', () => {
  it('says where the JSON chunk ends, padding included', () => {
    const bytes = glb(MODEL);
    const view = new DataView(bytes.buffer);
    expect(readGlbHeader(bytes).jsonEnd).toBe(20 + view.getUint32(12, true));
    expect(readGlbHeader(bytes).jsonEnd % 4).toBe(0);
  });

  it('needs only the first 20 bytes', () => {
    expect(readGlbHeader(glb(MODEL).subarray(0, 20)).jsonEnd).toBeGreaterThan(20);
  });

  it('refuses a file that is too short, has the wrong magic, version or first chunk', () => {
    expect(() => readGlbHeader(glb(MODEL).subarray(0, 19))).toThrow(/too short/);
    expect(() => readGlbHeader(glb(MODEL, { magic: 0x12345678 }))).toThrow(/bad magic/);
    expect(() => readGlbHeader(glb(MODEL, { version: 1 }))).toThrow(/version 1/);
    expect(() => readGlbHeader(glb(MODEL, { firstChunk: 0x004e4942 }))).toThrow(/not JSON/);
  });

  it('reads a view that does not start at the buffer’s start', () => {
    const bytes = glb(MODEL);
    const shifted = new Uint8Array(bytes.length + 7);
    shifted.set(bytes, 7);
    expect(readGlbHeader(shifted.subarray(7)).jsonEnd).toBe(readGlbHeader(bytes).jsonEnd);
  });
});

describe('readGlbJson', () => {
  it('parses the JSON chunk and leaves the binary one alone', () => {
    expect(readGlbJson(glb(MODEL, { bin: 1024 }))).toEqual(MODEL);
  });

  it('parses from a buffer that stops at the end of the JSON chunk', () => {
    const bytes = glb(MODEL);
    expect(readGlbJson(bytes.subarray(0, readGlbHeader(bytes).jsonEnd))).toEqual(MODEL);
  });

  it('throws when the chunk is cut short', () => {
    const bytes = glb(MODEL);
    expect(() => readGlbJson(bytes.subarray(0, readGlbHeader(bytes).jsonEnd - 4))).toThrow(
      /cut short/,
    );
  });

  it('throws when the JSON does not parse or is not an object', () => {
    expect(() => readGlbJson(glb('{"nodes": [}'))).toThrow(/does not parse/);
    expect(() => readGlbJson(glb('[1, 2]'))).toThrow(/not an object/);
    expect(() => readGlbJson(glb('null'))).toThrow(/not an object/);
  });
});

describe('nodeInfos', () => {
  it('returns the class root with its children in order and the extras as the file has them', () => {
    expect(nodeInfos(MODEL)).toEqual({
      name: 'Tower',
      children: [
        { name: 'Fan', extras: { bind: 'fanSpeedRpm', motion: 'spin' }, children: [] },
        { name: 'Casing', children: [] },
      ],
    });
  });

  it('skips a _LOD1 root wherever it stands in the scene', () => {
    const json = { scenes: [{ nodes: [1, 0] }], nodes: [{ name: 'A' }, { name: 'A_LOD1' }] };
    expect(nodeInfos(json)?.name).toBe('A');
  });

  it('reads the scene the file names, and the first one when it names none', () => {
    const nodes = [{ name: 'One' }, { name: 'Two' }];
    const scenes = [{ nodes: [0] }, { nodes: [1] }];
    expect(nodeInfos({ nodes, scenes, scene: 1 })?.name).toBe('Two');
    expect(nodeInfos({ nodes, scenes })?.name).toBe('One');
  });

  it('gives an unnamed node the name "" and keeps extras that are not an object', () => {
    const json = { scenes: [{ nodes: [0] }], nodes: [{ children: [1] }, { extras: 'x' }] };
    expect(nodeInfos(json)).toEqual({
      name: '',
      children: [{ name: '', extras: 'x', children: [] }],
    });
  });

  it('follows a node reached twice once, and does not loop on a cycle', () => {
    const shared = {
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Root', children: [1, 1, 2] }, { name: 'Shared' }, { name: 'Other' }],
    };
    expect(nodeInfos(shared)?.children?.map((child) => child.name)).toEqual(['Shared', 'Other']);

    const cycle = { scenes: [{ nodes: [0] }], nodes: [{ name: 'A', children: [0] }] };
    expect(nodeInfos(cycle)).toEqual({ name: 'A', children: [] });
  });

  it('returns null for a file with no usable root, and ignores indices that point nowhere', () => {
    expect(nodeInfos({})).toBeNull();
    expect(nodeInfos({ scenes: [{ nodes: [] }], nodes: [] })).toBeNull();
    expect(nodeInfos({ scenes: [{ nodes: [0] }], nodes: [{ name: 'Only_LOD1' }] })).toBeNull();
    expect(nodeInfos({ scenes: [{ nodes: [9] }], nodes: [{ name: 'A' }] })).toBeNull();
    expect(
      nodeInfos({ scenes: [{ nodes: [0] }], nodes: [{ name: 'A', children: [9, -1, 'x'] }] }),
    ).toEqual({ name: 'A', children: [] });
    expect(nodeInfos({ scenes: 'x', nodes: 'y' })).toBeNull();
  });
});

/** A fake `fetch` that serves `file`, answering `Range` as nginx does (206) or ignoring it as Vite does (200). */
function serve(file: Uint8Array, { ranges = true } = {}) {
  const requests: { url: string; range: string | undefined }[] = [];
  const fetcher = (url: string, init: { headers: Record<string, string> }): Promise<Response> => {
    const range = init.headers.Range;
    requests.push({ url, range });
    const match = /^bytes=0-(\d+)$/.exec(range ?? '');
    const last = ranges && match !== null ? Number(match[1]) : null;
    const body = last === null ? file : file.slice(0, last + 1);
    return Promise.resolve({
      ok: true,
      status: last === null ? 200 : 206,
      arrayBuffer: () =>
        Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.length)),
    } as unknown as Response);
  };
  return { fetcher, requests };
}

const reply =
  (status: number, bytes: Uint8Array = new Uint8Array(0)) =>
  (): Promise<Response> =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    } as unknown as Response);

/** A model whose JSON chunk is longer than the first read. */
const LONG = { ...MODEL, padding: 'x'.repeat(FIRST_READ_BYTES + 100) };

describe('fetchGlbJson', () => {
  it('asks for the first 64 KiB and reads a small model from that one answer', async () => {
    const { fetcher, requests } = serve(glb(MODEL, { bin: 100_000 }));

    await expect(fetchGlbJson('/models/tower.abc.glb', fetcher)).resolves.toEqual(MODEL);
    expect(requests).toEqual([{ url: '/models/tower.abc.glb', range: 'bytes=0-65535' }]);
  });

  it('reads a server that ignores Range and sends the whole file', async () => {
    const { fetcher, requests } = serve(glb(MODEL, { bin: 100_000 }), { ranges: false });

    await expect(fetchGlbJson('/m.glb', fetcher)).resolves.toEqual(MODEL);
    expect(requests).toHaveLength(1);
  });

  it('asks for exactly the JSON chunk’s bytes when it is longer than the first read', async () => {
    const file = glb(LONG);
    const { fetcher, requests } = serve(file);

    await expect(fetchGlbJson('/m.glb', fetcher)).resolves.toEqual(LONG);
    expect(requests.map((request) => request.range)).toEqual([
      'bytes=0-65535',
      `bytes=0-${readGlbHeader(file).jsonEnd - 1}`,
    ]);
  });

  it('needs one request when a long JSON chunk comes whole with the file', async () => {
    const { fetcher, requests } = serve(glb(LONG), { ranges: false });

    await expect(fetchGlbJson('/m.glb', fetcher)).resolves.toEqual(LONG);
    expect(requests).toHaveLength(1);
  });

  it('throws on an HTTP error, naming the status', async () => {
    await expect(fetchGlbJson('/m.glb', reply(404))).rejects.toThrow(/HTTP 404/);
    await expect(fetchGlbJson('/m.glb', reply(500))).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a body that is not a GLB, such as an HTML page served for a missing file', async () => {
    const page = new TextEncoder().encode('<!doctype html><title>x</title>'.padEnd(40, ' '));
    await expect(fetchGlbJson('/m.glb', reply(200, page))).rejects.toThrow(/not a GLB/);
  });

  it('refuses a header that claims more JSON than the console reads, without a second request', async () => {
    const bytes = glb(MODEL);
    new DataView(bytes.buffer).setUint32(12, MAX_JSON_BYTES, true);
    const { fetcher, requests } = serve(bytes.subarray(0, 40));

    await expect(fetchGlbJson('/m.glb', fetcher)).rejects.toThrow(/more than/);
    expect(requests).toHaveLength(1);
  });

  it('throws on a whole file that is shorter than its header says', async () => {
    const bytes = glb(MODEL);
    const short = bytes.subarray(0, readGlbHeader(bytes).jsonEnd - 8);

    await expect(fetchGlbJson('/m.glb', reply(200, short))).rejects.toThrow(/shorter/);
  });

  it('throws when the second answer is cut short too', async () => {
    const file = glb(LONG);
    const truncated = file.slice(0, readGlbHeader(file).jsonEnd - 4);
    let calls = 0;
    const fetcher = (): Promise<Response> => {
      calls += 1;
      const body = calls === 1 ? file.slice(0, FIRST_READ_BYTES) : truncated;
      return Promise.resolve({
        ok: true,
        status: 206,
        arrayBuffer: () => Promise.resolve(body.buffer),
      } as unknown as Response);
    };

    await expect(fetchGlbJson('/m.glb', fetcher)).rejects.toThrow(/cut short/);
  });

  describe('with the global fetch', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('is the default, called with the URL and the Range header', async () => {
      const { fetcher } = serve(glb(MODEL));
      const global = vi.fn(fetcher);
      vi.stubGlobal('fetch', global);

      await expect(fetchGlbJson('/models/x.glb')).resolves.toEqual(MODEL);
      expect(global).toHaveBeenCalledWith('/models/x.glb', { headers: { Range: 'bytes=0-65535' } });
    });
  });
});
