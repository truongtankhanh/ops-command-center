import { renderHook } from '@testing-library/react';

/** jsdom has no Web Audio: just enough of an `AudioContext` to see what the cue does with it. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static resumeFails = false;

  state: AudioContextState = 'suspended';
  currentTime = 0;
  destination = {};
  oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];

  resume = vi.fn(async () => {
    if (FakeAudioContext.resumeFails) throw new Error('Not allowed to start');
    this.state = 'running';
  });

  createOscillator = vi.fn(() => {
    const oscillator = {
      frequency: { value: 0 },
      connect: vi.fn((next: unknown) => next),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  });

  createGain = vi.fn(() => ({
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn((next: unknown) => next),
  }));

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

const KEY = 'occ.console.criticalSound';
const contexts = () => FakeAudioContext.instances;
const tones = () => contexts()[0]?.oscillators.length ?? 0;

/** The module keeps its audio context and last play time: every case loads a fresh copy. */
const load = () => import('./criticalCue');

describe('criticalCue', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    FakeAudioContext.instances = [];
    FakeAudioContext.resumeFails = false;
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('the remembered choice', () => {
    it('is off until turned on, and forgotten when turned off', async () => {
      const cue = await load();
      expect(cue.readCriticalSound()).toBe(false);

      cue.writeCriticalSound(true);
      expect(cue.readCriticalSound()).toBe(true);
      expect(localStorage.getItem(KEY)).toBe('true');

      cue.writeCriticalSound(false);
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('is off, and turning it on does not throw, when storage is blocked', async () => {
      const blocked = () => {
        throw new Error('Storage is disabled');
      };
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
      const cue = await load();

      expect(cue.readCriticalSound()).toBe(false);
      expect(() => cue.writeCriticalSound(true)).not.toThrow();
    });
  });

  describe('unlockAudio', () => {
    it('creates and resumes one audio context', async () => {
      const cue = await load();

      await expect(cue.unlockAudio()).resolves.toBe(true);

      expect(contexts()).toHaveLength(1);
      expect(contexts()[0]!.resume).toHaveBeenCalledTimes(1);
    });

    it('reuses the running context', async () => {
      const cue = await load();
      await cue.unlockAudio();

      await expect(cue.unlockAudio()).resolves.toBe(true);

      expect(contexts()).toHaveLength(1);
      expect(contexts()[0]!.resume).toHaveBeenCalledTimes(1);
    });

    it('reports no audio when the browser has no Web Audio', async () => {
      vi.stubGlobal('AudioContext', undefined);
      const cue = await load();

      await expect(cue.unlockAudio()).resolves.toBe(false);
      expect(() => cue.playCriticalCue()).not.toThrow();
    });

    it('reports no audio when the browser refuses to start it, and then plays nothing', async () => {
      FakeAudioContext.resumeFails = true;
      const cue = await load();

      await expect(cue.unlockAudio()).resolves.toBe(false);
      cue.playCriticalCue();

      expect(tones()).toBe(0);
    });
  });

  describe('playCriticalCue', () => {
    it('plays nothing, and creates no context, before audio is unlocked', async () => {
      const cue = await load();

      cue.playCriticalCue();

      expect(contexts()).toHaveLength(0);
    });

    it('plays two tones once unlocked', async () => {
      const cue = await load();
      await cue.unlockAudio();

      cue.playCriticalCue();

      const oscillators = contexts()[0]!.oscillators;
      expect(oscillators).toHaveLength(2);
      for (const oscillator of oscillators) {
        expect(oscillator.start).toHaveBeenCalledTimes(1);
        expect(oscillator.stop).toHaveBeenCalledTimes(1);
      }
    });

    // A burst of critical incidents plays one cue, not one per incident.
    it('plays at most once every two seconds', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const t = new Date('2026-10-08T08:00:00Z').getTime();
      const cue = await load();
      await cue.unlockAudio();

      vi.setSystemTime(t);
      cue.playCriticalCue();
      vi.setSystemTime(t + 1999);
      cue.playCriticalCue();
      expect(tones()).toBe(2);

      vi.setSystemTime(t + 2000);
      cue.playCriticalCue();
      expect(tones()).toBe(4);
    });

    it('always plays a preview, the switch being turned on', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const t = new Date('2026-10-08T08:00:00Z').getTime();
      const cue = await load();
      await cue.unlockAudio();

      vi.setSystemTime(t);
      cue.playCriticalCue();
      vi.setSystemTime(t + 1);
      cue.playCriticalCue({ preview: true });

      expect(tones()).toBe(4);
    });
  });

  describe('useAudioUnlock', () => {
    const press = (type: 'pointerdown' | 'keydown') => window.dispatchEvent(new Event(type));

    it('unlocks audio on the next press, then stops listening', async () => {
      const removed = vi.spyOn(window, 'removeEventListener');
      const cue = await load();
      renderHook(() => cue.useAudioUnlock(true));

      press('pointerdown');

      await vi.waitFor(() =>
        expect(removed.mock.calls.map(([type]) => type)).toEqual(
          expect.arrayContaining(['pointerdown', 'keydown']),
        ),
      );
      const context = contexts()[0]!;
      expect(context.resume).toHaveBeenCalledTimes(1);

      // Were it still listening, a press would resume a context that was suspended again.
      context.state = 'suspended';
      press('keydown');
      expect(context.resume).toHaveBeenCalledTimes(1);
    });

    it('does not listen while the sound is off', async () => {
      const cue = await load();
      renderHook(() => cue.useAudioUnlock(false));

      press('pointerdown');

      expect(contexts()).toHaveLength(0);
    });

    it('does nothing without Web Audio', async () => {
      vi.stubGlobal('AudioContext', undefined);
      const cue = await load();
      renderHook(() => cue.useAudioUnlock(true));

      expect(() => press('pointerdown')).not.toThrow();
    });

    it('stops listening when unmounted', async () => {
      const cue = await load();
      const { unmount } = renderHook(() => cue.useAudioUnlock(true));

      unmount();
      press('pointerdown');

      expect(contexts()).toHaveLength(0);
    });
  });
});
