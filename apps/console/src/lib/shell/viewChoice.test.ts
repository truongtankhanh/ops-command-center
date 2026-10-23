import type { TwinCapability } from '../twin-core/twinCapability';
import { effectiveView, readViewChoice, writeViewChoice } from './viewChoice';

const KEY = 'occ.console.view';

beforeEach(() => localStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('the remembered view choice', () => {
  it('reads back what it wrote', () => {
    writeViewChoice('3d');
    expect(readViewChoice()).toBe('3d');
    expect(localStorage.getItem(KEY)).toBe('3d');

    writeViewChoice('2d');
    expect(readViewChoice()).toBe('2d');
    expect(localStorage.getItem(KEY)).toBe('2d');
  });

  it('is no choice when nothing or something unknown is stored', () => {
    expect(readViewChoice()).toBeNull();

    localStorage.setItem(KEY, 'isometric');

    expect(readViewChoice()).toBeNull();
  });

  it('does not write anything when it reads', () => {
    localStorage.setItem(KEY, '3d');

    readViewChoice();

    expect(localStorage.getItem(KEY)).toBe('3d');
  });

  it('is no choice, and remembering does not throw, when storage is blocked', () => {
    const blocked = () => {
      throw new Error('Storage is disabled');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);

    expect(readViewChoice()).toBeNull();
    expect(() => writeViewChoice('2d')).not.toThrow();
  });
});

describe('effectiveView', () => {
  const available: TwinCapability = { available: true };
  const unavailable: TwinCapability = { available: false, reason: 'no-webgl2' };

  it('is 2D whatever was chosen while the twin cannot be drawn', () => {
    expect(effectiveView('3d', unavailable)).toBe('2d');
    expect(effectiveView('2d', unavailable)).toBe('2d');
    expect(effectiveView(null, unavailable)).toBe('2d');
  });

  it('keeps an explicit choice where the twin can be drawn', () => {
    expect(effectiveView('3d', available)).toBe('3d');
    expect(effectiveView('2d', available)).toBe('2d');
  });

  it('defaults to 3D where the twin can be drawn and nothing was chosen', () => {
    expect(effectiveView(null, available)).toBe('3d');
  });
});
