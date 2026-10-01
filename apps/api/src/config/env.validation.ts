import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['true', '1', 'yes'].includes(value.toLowerCase()) : value;

/**
 * Every environment variable the API reads, with its rules and defaults.
 * The API refuses to start when this does not validate.
 */
export class Env {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  DATABASE_URL: string;

  @Transform(toBoolean)
  @IsBoolean()
  SEED_ON_BOOT = true;

  @Transform(toBoolean)
  @IsBoolean()
  SIMULATOR_ENABLED = false;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  SIMULATOR_INTERVAL_MS = 8000;

  @IsIn(['mock', 'mediamtx'])
  CAMERA_SOURCE: 'mock' | 'mediamtx' = 'mock';

  @ValidateIf((env: Env) => env.CAMERA_SOURCE === 'mediamtx')
  @IsUrl({ require_tld: false })
  MEDIAMTX_HLS_URL?: string;

  @ValidateIf((env: Env) => env.CAMERA_SOURCE === 'mediamtx')
  @IsUrl({ require_tld: false })
  MEDIAMTX_WEBRTC_URL?: string;

  @IsOptional()
  @IsIn(['hls', 'webrtc'])
  MEDIAMTX_PROTOCOL: 'hls' | 'webrtc' = 'hls';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw);
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
