import { createGpuTimer, type TimerQueryContext } from './twinGpuTimer';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;

interface FakeQuery {
  id: number;
  /** Nanoseconds, or `null` while the GPU has not answered. */
  result: number | null;
}

/**
 * A WebGL 2 context with just the timer query calls: each query's result is set by the case (`answer`), the disjoint
 * flag too, and every call is recorded. `throwOn` makes one call throw, as a lost context does.
 */
function fakeContext({ extension = true }: { extension?: boolean } = {}) {
  const queries: FakeQuery[] = [];
  const deleted: FakeQuery[] = [];
  const state = {
    disjoint: false,
    active: null as FakeQuery | null,
    throwOn: null as string | null,
  };
  const call = (name: string) => {
    if (state.throwOn === name) throw new Error(`${name}: context lost`);
  };
  const gl: TimerQueryContext = {
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    getExtension: (name) => {
      call('getExtension');
      return extension && name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
        : null;
    },
    createQuery: () => {
      call('createQuery');
      const query: FakeQuery = { id: queries.length + 1, result: null };
      queries.push(query);
      return query as unknown as WebGLQuery;
    },
    beginQuery: (target, query) => {
      call('beginQuery');
      expect(target).toBe(TIME_ELAPSED_EXT);
      expect(state.active).toBeNull();
      state.active = query as unknown as FakeQuery;
      state.active.result = null;
    },
    endQuery: (target) => {
      call('endQuery');
      expect(target).toBe(TIME_ELAPSED_EXT);
      state.active = null;
    },
    getParameter: (pname) => {
      call('getParameter');
      return pname === GPU_DISJOINT_EXT ? state.disjoint : null;
    },
    getQueryParameter: (query, pname) => {
      call('getQueryParameter');
      const { result } = query as unknown as FakeQuery;
      return pname === QUERY_RESULT_AVAILABLE ? result !== null : result;
    },
    deleteQuery: (query) => {
      deleted.push(query as unknown as FakeQuery);
    },
  };
  /** The GPU answers the query with this id. */
  const answer = (id: number, ns: number) => {
    const query = queries.find((each) => each.id === id);
    if (query === undefined) throw new Error(`no query ${id}`);
    query.result = ns;
  };
  return { gl, state, queries, deleted, answer };
}

/** One timed frame: begin, end. */
const frame = (timer: NonNullable<ReturnType<typeof createGpuTimer>>, keep = true) => {
  timer.begin();
  timer.end(keep);
};

describe('createGpuTimer', () => {
  it('is null without the extension, and when asking for it throws', () => {
    expect(createGpuTimer(fakeContext({ extension: false }).gl)).toBeNull();

    const throwing = fakeContext();
    throwing.state.throwOn = 'getExtension';
    expect(createGpuTimer(throwing.gl)).toBeNull();
  });

  it('is null when the extension has no numeric constants', () => {
    const { gl } = fakeContext();
    const broken = { ...gl, getExtension: () => ({}) };

    expect(createGpuTimer(broken)).toBeNull();
  });

  it('reads a finished frame in milliseconds', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;

    frame(timer);
    fake.answer(1, 5_100_000);

    expect(timer.poll()).toEqual([5.1]);
    expect(timer.poll()).toEqual([]);
  });

  it('waits for a result that is not back yet, and reads results in the order the frames ended', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;
    frame(timer);
    frame(timer);
    frame(timer);

    // The second is back before the first: nothing is read past the first that is not.
    fake.answer(2, 2_000_000);
    expect(timer.poll()).toEqual([]);

    fake.answer(1, 1_000_000);
    expect(timer.poll()).toEqual([1, 2]);

    fake.answer(3, 3_000_000);
    expect(timer.poll()).toEqual([3]);
  });

  it('drops every pending result after a disjoint, and times again afterwards', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;
    frame(timer);
    frame(timer);
    fake.answer(1, 1_000_000);
    fake.answer(2, 2_000_000);
    fake.state.disjoint = true;

    expect(timer.poll()).toEqual([]);

    fake.state.disjoint = false;
    frame(timer);
    const reused = fake.queries.find(({ result }) => result === null);
    fake.answer(reused?.id ?? 0, 4_000_000);
    expect(timer.poll()).toEqual([4]);
  });

  it('drops the result of a frame ended with keep false, and keeps its place in the order', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;
    frame(timer, false);
    frame(timer);
    fake.answer(1, 50_000_000);
    fake.answer(2, 6_000_000);

    expect(timer.poll()).toEqual([6]);
  });

  it('times no frame while every query of the pool is still pending', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl, { poolSize: 2 })!;
    frame(timer);
    frame(timer);

    frame(timer);

    expect(fake.queries).toHaveLength(2);
    fake.answer(1, 1_000_000);
    fake.answer(2, 2_000_000);
    expect(timer.poll()).toEqual([1, 2]);

    // Both are free again: the next frame reuses one and creates none.
    frame(timer);
    expect(fake.queries).toHaveLength(2);
  });

  it('ignores an end with no begin, and a second begin while one is active', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;

    timer.end();
    timer.begin();
    timer.begin();
    timer.end();

    expect(fake.queries).toHaveLength(1);
    fake.answer(1, 1_000_000);
    expect(timer.poll()).toEqual([1]);
  });

  it('leaves out a result that is not a finite number', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;
    frame(timer);
    fake.answer(1, Number.NaN);

    expect(timer.poll()).toEqual([]);
  });

  it.each(['createQuery', 'beginQuery', 'endQuery', 'getParameter', 'getQueryParameter'])(
    'stops for good, without throwing, when %s throws, and deletes its queries',
    (name) => {
      const fake = fakeContext();
      const timer = createGpuTimer(fake.gl)!;
      frame(timer);
      fake.answer(1, 1_000_000);

      fake.state.throwOn = name;
      expect(() => {
        frame(timer);
        timer.poll();
      }).not.toThrow();

      fake.state.throwOn = null;
      frame(timer);
      expect(timer.poll()).toEqual([]);
      expect(fake.deleted.map(({ id }) => id)).toContain(1);
    },
  );

  it('deletes every query on dispose and answers nothing afterwards', () => {
    const fake = fakeContext();
    const timer = createGpuTimer(fake.gl)!;
    frame(timer);
    frame(timer);

    timer.dispose();

    expect(fake.deleted.map(({ id }) => id).sort()).toEqual([1, 2]);
    frame(timer);
    expect(fake.queries).toHaveLength(2);
    expect(timer.poll()).toEqual([]);
  });
});
