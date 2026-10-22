import { act, renderHook } from '@testing-library/react';
import { reauthenticate } from '../../auth/session';
import { useSession } from '../../auth/store';
import {
  clearReauth,
  readReauth,
  REAUTH_BASE_MS,
  REAUTH_STALE_MS,
  writeReauth,
} from '../../lib/wall/wallReauth';
import { resetStore } from '../../test-utils';
import { useWallReauth } from './useWallReauth';

vi.mock('../../auth/session', () => ({ reauthenticate: vi.fn() }));

/** Moves the clock and lets React render what the attempts set (`setRound`) inside it, so the next round is scheduled. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const flush = () => advance(0);

describe('useWallReauth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
    sessionStorage.clear();
    clearReauth();
    resetStore(useSession);
    useSession.getState().signedIn({ displayName: 'Wall', roles: ['viewer'] });
    useSession.getState().expire();
    vi.mocked(reauthenticate).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('signs in again at once the first time, without a click', async () => {
    renderHook(() => useWallReauth());

    await advance(0);

    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it('records the attempt before it leaves, because the page is gone after the redirect', async () => {
    let recordedBefore = false;
    vi.mocked(reauthenticate).mockImplementation(() => {
      recordedBefore = readReauth().attempts === 1;
      return new Promise(() => {}); // the redirect: this page never gets an answer
    });
    renderHook(() => useWallReauth());

    await advance(0);

    expect(recordedBefore).toBe(true);
  });

  it('tries again after a minute, then two, then four, while nothing took the page away', async () => {
    renderHook(() => useWallReauth());
    await advance(0);
    expect(reauthenticate).toHaveBeenCalledTimes(1);

    await advance(REAUTH_BASE_MS - 1);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(reauthenticate).toHaveBeenCalledTimes(2);

    await advance(2 * REAUTH_BASE_MS - 1);
    expect(reauthenticate).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(reauthenticate).toHaveBeenCalledTimes(3);

    await advance(4 * REAUTH_BASE_MS);
    expect(reauthenticate).toHaveBeenCalledTimes(4);
  });

  it('waits out the back-off a page before it left, even on a fresh page (a loop through redirects)', async () => {
    writeReauth({ attempts: 2, at: Date.now() - 10_000 });
    renderHook(() => useWallReauth());

    await advance(2 * REAUTH_BASE_MS - 10_001);
    expect(reauthenticate).not.toHaveBeenCalled();
    await advance(1);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it('starts from the shortest gap when the last run is long over', async () => {
    writeReauth({ attempts: 6, at: Date.now() - REAUTH_STALE_MS - 1 });
    renderHook(() => useWallReauth());

    await flush();

    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it('stops, and forgets the run, when the session heals in this page', async () => {
    const { unmount } = renderHook(() => useWallReauth());
    await flush();
    expect(readReauth().attempts).toBe(1);

    useSession.getState().signedIn({ displayName: 'Wall', roles: ['viewer'] });
    unmount();
    await advance(10 * 60_000);

    expect(readReauth().attempts).toBe(0);
    expect(reauthenticate).toHaveBeenCalledTimes(1);
  });

  it('keeps the run when it goes away while the session is still failing', async () => {
    const { unmount } = renderHook(() => useWallReauth());
    await flush();

    unmount();

    expect(readReauth().attempts).toBe(1);
  });
});
