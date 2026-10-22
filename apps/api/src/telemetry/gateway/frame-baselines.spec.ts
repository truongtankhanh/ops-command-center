import { FrameBaselines } from './frame-baselines';

describe('FrameBaselines', () => {
  it('reports every key of an asset it has never been told about', () => {
    const baselines = new FrameBaselines();

    expect(baselines.diff('CT-01', { temp: 20, running: true })).toEqual({
      temp: 20,
      running: true,
    });
  });

  it('reports nothing when every value is what the room already has', () => {
    const baselines = new FrameBaselines();
    baselines.diff('CT-01', { temp: 20 });

    expect(baselines.diff('CT-01', { temp: 20 })).toBeUndefined();
  });

  it('reports only the keys that differ or are new, and remembers them', () => {
    const baselines = new FrameBaselines();
    baselines.diff('CT-01', { temp: 20, pressure: 4 });

    expect(baselines.diff('CT-01', { temp: 21, pressure: 4, mode: 'run' })).toEqual({
      temp: 21,
      mode: 'run',
    });
    expect(baselines.diff('CT-01', { temp: 21, mode: 'run' })).toBeUndefined();
  });

  it('keeps one baseline per asset', () => {
    const baselines = new FrameBaselines();
    baselines.diff('CT-01', { temp: 20 });

    expect(baselines.diff('CT-02', { temp: 20 })).toEqual({ temp: 20 });
  });

  it('tells apart values of different kinds that compare loosely equal', () => {
    const baselines = new FrameBaselines();
    baselines.diff('CT-01', { running: false, level: 0, mode: '' });

    expect(baselines.diff('CT-01', { running: 0 as unknown as boolean })).toEqual({ running: 0 });
    expect(baselines.diff('CT-01', { level: false as unknown as number })).toEqual({
      level: false,
    });
    expect(baselines.diff('CT-01', { mode: 0 as unknown as string })).toEqual({ mode: 0 });
  });

  describe('seed', () => {
    it('makes the first frame the first change, not a repeat of the snapshot', () => {
      const baselines = new FrameBaselines();
      baselines.seed('CT-01', { temp: 20, pressure: 4 });

      expect(baselines.diff('CT-01', { temp: 20, pressure: 4 })).toBeUndefined();
      expect(baselines.diff('CT-01', { temp: 22, pressure: 4 })).toEqual({ temp: 22 });
    });

    it('takes a copy: changing the seeded object afterwards changes nothing', () => {
      const baselines = new FrameBaselines();
      const values = { temp: 20 };
      baselines.seed('CT-01', values);

      values.temp = 99;

      expect(baselines.diff('CT-01', { temp: 20 })).toBeUndefined();
    });

    it('with nothing held, makes every key of the first reading a change', () => {
      const baselines = new FrameBaselines();
      baselines.seed('CT-01', {});

      expect(baselines.has('CT-01')).toBe(true);
      expect(baselines.diff('CT-01', { temp: 20 })).toEqual({ temp: 20 });
    });

    it('replaces what was there', () => {
      const baselines = new FrameBaselines();
      baselines.diff('CT-01', { temp: 20, pressure: 4 });

      baselines.seed('CT-01', { temp: 30 });

      expect(baselines.diff('CT-01', { temp: 20, pressure: 4 })).toEqual({ temp: 20, pressure: 4 });
    });
  });

  describe('retain', () => {
    it('forgets every asset that is not watched any more, and only those', () => {
      const baselines = new FrameBaselines();
      baselines.seed('CT-01', { temp: 20 });
      baselines.seed('CT-02', { temp: 30 });

      baselines.retain(new Set(['CT-02']));

      expect(baselines.has('CT-01')).toBe(false);
      expect(baselines.has('CT-02')).toBe(true);
      expect(baselines.diff('CT-02', { temp: 30 })).toBeUndefined();
    });

    it('lets a forgotten asset be reported in full when it is watched again', () => {
      const baselines = new FrameBaselines();
      baselines.seed('CT-01', { temp: 20 });
      baselines.retain(new Set());

      expect(baselines.diff('CT-01', { temp: 20 })).toEqual({ temp: 20 });
    });

    it('is safe on an empty set of baselines', () => {
      expect(() => new FrameBaselines().retain(new Set(['CT-01']))).not.toThrow();
    });
  });

  it('forgets everything on `clear`', () => {
    const baselines = new FrameBaselines();
    baselines.seed('CT-01', { temp: 20 });
    baselines.seed('CT-02', { temp: 30 });

    baselines.clear();

    expect(baselines.has('CT-01')).toBe(false);
    expect(baselines.has('CT-02')).toBe(false);
  });
});
