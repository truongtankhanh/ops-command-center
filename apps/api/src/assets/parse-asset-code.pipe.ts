import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

/**
 * The operators' tag of an asset: `CT-01`, `AHU-C1`, `ICS-SPORTS`. The same pattern as the
 * database's `asset_code_check` (`AssetCatalogue1791793800000`, ADR-0018); the migration keeps its
 * own literal on purpose, because a migration must keep doing what it did when it first ran.
 * Case-sensitive: `ct-01` is not an asset tag.
 */
export const ASSET_CODE_PATTERN = /^[A-Z]{2,4}-[A-Z0-9]{2,6}$/;

/**
 * Validates the `:code` of `/assets/:code` before any lookup, so a `404` message only ever echoes a
 * string that already matched the pattern. The global `ValidationPipe` checks DTOs, not a single
 * path parameter, so this route has its own pipe, as `ParseUUIDPipe` serves the `:id` routes. The
 * error has the same shape as body validation errors.
 */
@Injectable()
export class ParseAssetCodePipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!ASSET_CODE_PATTERN.test(value)) {
      throw new BadRequestException([
        'code must be an asset tag such as CT-01: 2 to 4 capital letters, a hyphen, ' +
          'then 2 to 6 capital letters or digits',
      ]);
    }
    return value;
  }
}
