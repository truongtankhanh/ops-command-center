import { useEffect } from 'react';

/**
 * The sound for a new critical incident: a short two-tone beep synthesised with the Web Audio API,
 * so there is no audio file to ship. Off by default; the operator turns it on in the user menu.
 *
 * Browsers start audio only after a user gesture (autoplay rules), so the one `AudioContext` is
 * created and resumed from a gesture: the switch's own click, or after a reload the first pointer
 * or key press (`useAudioUnlock`). Until then a critical arrival plays nothing — the toast, the
 * title and the row still show it. Without Web Audio every call is a no-op.
 */

const STORAGE_KEY = 'occ.console.criticalSound';

/** A burst of critical incidents plays one cue, not one per incident. */
const MIN_GAP_MS = 2000;

/** High then low, like a door chime: noticeable without sounding like an alarm siren. */
const TONES = [
  { hz: 880, offset: 0 },
  { hz: 660, offset: 0.18 },
];
const TONE_S = 0.15;
const VOLUME = 0.2;

let context: AudioContext | null = null;
let lastPlayedAt = -Infinity;

const audioSupported = () => typeof window.AudioContext === 'function';

/** A function, so TypeScript does not keep a narrowed `state` across an `await`. */
const isRunning = (audio: AudioContext) => audio.state === 'running';

/** Whether the sound is on in this browser. Storage can be unavailable; then it is off. */
export function readCriticalSound(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeCriticalSound(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'true');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Not remembered: the choice still holds until the page reloads.
  }
}

/**
 * Creates or resumes the audio context. Call it from a user gesture: `resume()` is called before
 * the first `await`, so it still counts as part of that gesture. Resolves to whether audio runs.
 */
export async function unlockAudio(): Promise<boolean> {
  if (!audioSupported()) return false;
  context ??= new AudioContext();
  if (isRunning(context)) return true;
  try {
    await context.resume();
  } catch {
    return false;
  }
  return isRunning(context);
}

/**
 * Plays the cue if audio is unlocked, at most once per `MIN_GAP_MS`; `preview` (the switch being
 * turned on) always plays. Never creates the context itself, so it never trips autoplay warnings.
 */
export function playCriticalCue({ preview = false }: { preview?: boolean } = {}): void {
  if (!context || !isRunning(context)) return;
  const now = Date.now();
  if (!preview && now - lastPlayedAt < MIN_GAP_MS) return;
  lastPlayedAt = now;

  const start = context.currentTime;
  for (const tone of TONES) {
    const at = start + tone.offset;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = tone.hz;
    // A quick fade in and out: a tone that starts or stops at full volume clicks.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(VOLUME, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + TONE_S);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + TONE_S);
  }
}

/**
 * While the sound is on, unlocks audio on the next pointer or key press anywhere on the page, then
 * stops listening. Needed after a reload: the remembered choice is on, but no gesture has happened.
 */
export function useAudioUnlock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !audioSupported()) return;
    const stop = () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    const unlock = () => {
      void unlockAudio().then((running) => {
        if (running) stop();
      });
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return stop;
  }, [enabled]);
}
