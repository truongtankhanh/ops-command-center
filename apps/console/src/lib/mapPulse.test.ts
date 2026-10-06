import type { Map as MapLibreMap } from 'maplibre-gl';
import { PULSE_WAVE, PULSE_WAVE_LAYERS } from './mapLayers';
import { pulseFrame, startPulse } from './mapPulse';

const PERIOD = 1800;

describe('pulseFrame', () => {
  it('starts small and nearly opaque', () => {
    const { radius, opacity } = pulseFrame(0, PERIOD);

    expect(radius).toBeCloseTo(PULSE_WAVE.radius * 0.7);
    expect(opacity).toBeCloseTo(0.9);
  });

  it('grows and fades towards the end of a cycle', () => {
    const middle = pulseFrame(PERIOD / 2, PERIOD);
    const end = pulseFrame(PERIOD - 1, PERIOD);

    expect(middle.radius).toBeGreaterThan(PULSE_WAVE.radius * 0.7);
    expect(end.radius).toBeGreaterThan(middle.radius);
    expect(end.radius).toBeCloseTo(PULSE_WAVE.radius * 1.8, 1);
    expect(end.opacity).toBeLessThan(middle.opacity);
    expect(end.opacity).toBeCloseTo(0, 2);
  });

  it('repeats every period', () => {
    expect(pulseFrame(PERIOD + 300, PERIOD)).toEqual(pulseFrame(300, PERIOD));
  });
});

describe('startPulse', () => {
  let frames: FrameRequestCallback[];

  /** Runs the frame the loop asked for, at `time` ms. */
  const runFrame = (time: number) => frames.shift()!(time);

  function fakeMap(layers: readonly string[] = PULSE_WAVE_LAYERS) {
    const map = {
      style: {},
      getLayer: vi.fn((id: string) => (layers.includes(id) ? { id } : undefined)),
      setPaintProperty: vi.fn(),
    };
    return { map, instance: map as unknown as MapLibreMap };
  }

  beforeEach(() => {
    frames = [];
    let lastId = 0;
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return ++lastId;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('animates every pulse wave layer from the frame clock', () => {
    const { map, instance } = fakeMap();
    startPulse(instance, PERIOD);

    runFrame(1000 + 450);

    const { radius, opacity } = pulseFrame(450, PERIOD);
    for (const id of PULSE_WAVE_LAYERS) {
      expect(map.setPaintProperty).toHaveBeenCalledWith(id, 'circle-radius', radius);
      expect(map.setPaintProperty).toHaveBeenCalledWith(id, 'circle-stroke-opacity', opacity);
    }
  });

  it('skips frames that come sooner than 30 per second', () => {
    const { map, instance } = fakeMap();
    startPulse(instance, PERIOD);

    runFrame(1100);
    map.setPaintProperty.mockClear();
    runFrame(1110);
    expect(map.setPaintProperty).not.toHaveBeenCalled();

    runFrame(1140);
    expect(map.setPaintProperty).toHaveBeenCalled();
  });

  it('keeps asking for frames until stopped, then puts the wave back at rest', () => {
    const { map, instance } = fakeMap();
    const stop = startPulse(instance, PERIOD);
    runFrame(1100);
    map.setPaintProperty.mockClear();

    stop();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
    for (const id of PULSE_WAVE_LAYERS) {
      expect(map.setPaintProperty).toHaveBeenCalledWith(id, 'circle-radius', PULSE_WAVE.radius);
      expect(map.setPaintProperty).toHaveBeenCalledWith(
        id,
        'circle-stroke-opacity',
        PULSE_WAVE.opacity,
      );
    }
  });

  it('touches nothing on stop once the map is removed', () => {
    const { map, instance } = fakeMap();
    const stop = startPulse(instance, PERIOD);
    Reflect.deleteProperty(map, 'style');

    stop();

    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it('skips a wave layer that is not on the map', () => {
    const [present] = PULSE_WAVE_LAYERS;
    const { map, instance } = fakeMap([present!]);
    startPulse(instance, PERIOD);

    runFrame(1100);

    expect(map.setPaintProperty.mock.calls.every(([id]) => id === present)).toBe(true);
  });
});
