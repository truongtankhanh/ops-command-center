import {
  clearReauth,
  NO_REAUTH,
  readReauth,
  REAUTH_BASE_MS,
  REAUTH_MAX_MS,
  REAUTH_STALE_MS,
  reauthDelay,
  recordAttempt,
  writeReauth,
} from './wallReauth';

const T0 = 1_000_000_000_000;

/** The run `attempts` long, the last of which began at `T0`. */
const run = (attempts: number) => ({ attempts, at: T0 });

describe('reauthDelay', () => {
  it('lets the first attempt of a run go at once', () => {
    expect(reauthDelay(NO_REAUTH, T0)).toBe(0);
  });

  it('waits a minute after the first, then two, four, eight', () => {
    expect(reauthDelay(run(1), T0)).toBe(REAUTH_BASE_MS);
    expect(reauthDelay(run(2), T0)).toBe(2 * REAUTH_BASE_MS);
    expect(reauthDelay(run(3), T0)).toBe(4 * REAUTH_BASE_MS);
    expect(reauthDelay(run(4), T0)).toBe(8 * REAUTH_BASE_MS);
  });

  it('counts the gap from when the last attempt began, so time already waited is not waited twice', () => {
    expect(reauthDelay(run(1), T0 + 45_000)).toBe(15_000);
    expect(reauthDelay(run(1), T0 + REAUTH_BASE_MS)).toBe(0);
    expect(reauthDelay(run(1), T0 + 5 * REAUTH_BASE_MS)).toBe(0);
  });

  it('never exceeds the longest gap, however long the run', () => {
    expect(reauthDelay(run(5), T0)).toBe(REAUTH_MAX_MS);
    expect(reauthDelay(run(40), T0)).toBe(REAUTH_MAX_MS);
  });

  it('is never less than a minute between two attempts of one run, so a redirect loop cannot go faster', () => {
    let record = NO_REAUTH;
    let now = T0;
    const starts: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      now += reauthDelay(record, now);
      starts.push(now);
      record = recordAttempt(record, now);
      now += 1000; // the page comes back a second later and fails again
    }

    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(REAUTH_BASE_MS);
    }
  });

  it('forgets a run that is over: a failure long after the last starts from the shortest gap', () => {
    expect(reauthDelay(run(6), T0 + REAUTH_STALE_MS + 1)).toBe(0);
  });

  it('forgets a record from the future, which a clock that went backwards leaves', () => {
    expect(reauthDelay(run(3), T0 - 1)).toBe(0);
  });
});

describe('recordAttempt', () => {
  it('counts up inside a run and starts again after one', () => {
    expect(recordAttempt(NO_REAUTH, T0)).toEqual({ attempts: 1, at: T0 });
    expect(recordAttempt(run(2), T0 + 1000)).toEqual({ attempts: 3, at: T0 + 1000 });
    expect(recordAttempt(run(7), T0 + REAUTH_STALE_MS + 1)).toEqual({
      attempts: 1,
      at: T0 + REAUTH_STALE_MS + 1,
    });
  });
});

describe('the tab’s record', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearReauth();
  });

  it('survives a read after a write, and is gone after a clear', () => {
    writeReauth(run(3));
    expect(readReauth()).toEqual(run(3));

    clearReauth();
    expect(readReauth()).toEqual(NO_REAUTH);
  });

  it('reads anything that is not a record as none', () => {
    for (const junk of ['not json', '{"attempts":"3","at":1}', '{"attempts":1.5,"at":1}', 'null']) {
      sessionStorage.setItem('occ.console.wall.reauth', junk);
      expect(readReauth()).toEqual(NO_REAUTH);
    }
  });

  it('does not read a record into an empty tab from what a page wrote before (storage works, memory is stale)', () => {
    writeReauth(run(2));
    sessionStorage.clear();

    expect(readReauth()).toEqual(NO_REAUTH);
  });

  it('keeps the run for the page when storage is blocked', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const reading = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    writeReauth(run(2));

    expect(readReauth()).toEqual(run(2));
    blocked.mockRestore();
    reading.mockRestore();
  });
});
