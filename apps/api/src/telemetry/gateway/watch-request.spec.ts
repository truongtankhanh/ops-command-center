import { TELEMETRY_WATCH_LIMIT } from '@occ/contracts';
import { MAX_WATCH_CODES_READ, readWatchCodes } from './watch-request';

const KNOWN = new Set(['CT-01', 'CT-02', 'CT-03', 'CT-04', 'CT-05', 'AH-01']);
const isKnown = (code: string): boolean => KNOWN.has(code);
const watch = (assets: unknown[]) => ({ assets });

describe('readWatchCodes', () => {
  it('keeps the known codes, in the order they were asked for', () => {
    expect(readWatchCodes(watch(['CT-02', 'AH-01', 'CT-01']), isKnown)).toEqual([
      'CT-02',
      'AH-01',
      'CT-01',
    ]);
  });

  it('keeps `TELEMETRY_WATCH_LIMIT` codes at most: five asked for, four kept', () => {
    const codes = readWatchCodes(watch(['CT-01', 'CT-02', 'CT-03', 'CT-04', 'CT-05']), isKnown);

    expect(TELEMETRY_WATCH_LIMIT).toBe(4);
    expect(codes).toEqual(['CT-01', 'CT-02', 'CT-03', 'CT-04']);
  });

  it('ignores a code that is not in the catalogue', () => {
    expect(readWatchCodes(watch(['CT-01', 'XX-99']), isKnown)).toEqual(['CT-01']);
  });

  it('drops what is not usable before the limit, so it never uses up a slot', () => {
    const asked = ['XX-99', 7, 'CT-01', null, 'CT-01', 'CT-02', {}, 'CT-03', 'CT-04', 'CT-05'];

    expect(readWatchCodes(watch(asked), isKnown)).toEqual(['CT-01', 'CT-02', 'CT-03', 'CT-04']);
  });

  it('keeps a repeated code once', () => {
    expect(readWatchCodes(watch(['CT-01', 'CT-01', 'CT-01']), isKnown)).toEqual(['CT-01']);
  });

  it('looks at no more than `MAX_WATCH_CODES_READ` entries', () => {
    const junk = Array.from({ length: MAX_WATCH_CODES_READ }, (_, i) => `ZZ-${i}`);
    const asked = [...junk, 'CT-01'];
    const probe = jest.fn(isKnown);

    expect(readWatchCodes(watch(asked), probe)).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(MAX_WATCH_CODES_READ);
  });

  it('is empty for an empty list', () => {
    expect(readWatchCodes(watch([]), isKnown)).toEqual([]);
  });

  it('honours a limit of its own', () => {
    expect(readWatchCodes(watch(['CT-01', 'CT-02', 'CT-03']), isKnown, 2)).toEqual([
      'CT-01',
      'CT-02',
    ]);
  });

  it('ignores fields other than `assets`', () => {
    expect(readWatchCodes({ assets: ['CT-01'], role: 'supervisor' }, isKnown)).toEqual(['CT-01']);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 7],
    ['a string', 'CT-01'],
    ['a boolean', true],
    ['an empty array', []],
    ['a bare array of codes', ['CT-01']],
    ['an empty object', {}],
    ['`assets` as a string', { assets: 'CT-01' }],
    ['`assets` as an object', { assets: { 0: 'CT-01' } }],
    ['`assets` as null', { assets: null }],
  ])('accepts nothing, and does not throw, for %s', (_, payload) => {
    expect(() => readWatchCodes(payload, isKnown)).not.toThrow();
    expect(readWatchCodes(payload, isKnown)).toEqual([]);
  });

  it('does not ask the catalogue about an entry that is not a string', () => {
    const probe = jest.fn(isKnown);

    readWatchCodes(watch([1, null, {}, ['CT-01']]), probe);

    expect(probe).not.toHaveBeenCalled();
  });
});
