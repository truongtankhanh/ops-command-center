import { BadRequestException } from '@nestjs/common';
import { ASSETS } from '../database/seed/assets';
import { ASSET_CODE_PATTERN, ParseAssetCodePipe } from './parse-asset-code.pipe';

const pipe = new ParseAssetCodePipe();

/** What `transform` throws, or `undefined` when it accepts the value. */
const refusal = (value: string): unknown => {
  try {
    pipe.transform(value);
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('ParseAssetCodePipe', () => {
  it('accepts every code of the demo catalogue, so the pattern cannot drift from the seed', () => {
    for (const { code } of ASSETS) {
      expect([code, pipe.transform(code)]).toEqual([code, code]);
    }
  });

  it('accepts the shapes the pattern allows', () => {
    for (const code of ['CT-01', 'AHU-C1', 'ICS-SPORTS', 'AB-CD', 'ABCD-123456']) {
      expect([code, refusal(code)]).toEqual([code, undefined]);
    }
  });

  it('refuses what is not an asset tag with a 400 whose message is a list', () => {
    const malformed = [
      'ct-01', // case-sensitive
      'CT-1', // suffix too short
      'CT-0001X78', // suffix too long
      'C-01', // prefix too short
      'CTCTC-01', // prefix too long
      'CT_01',
      'CT-',
      '-01',
      'CT01',
      'CT-01 ',
      ' CT-01',
      'CT-01\n', // `$` must not match before a trailing newline
      'CT-0!',
      'not a code',
      '',
    ];

    for (const value of malformed) {
      const error = refusal(value);
      expect([value, error instanceof BadRequestException]).toEqual([value, true]);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: [expect.any(String)],
      });
    }
  });

  it('is the same pattern as the one it exports', () => {
    expect(ASSET_CODE_PATTERN.test('CT-01')).toBe(true);
    expect(ASSET_CODE_PATTERN.test('ct-01')).toBe(false);
  });
});
