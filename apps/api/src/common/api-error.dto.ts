import { ApiProperty } from '@nestjs/swagger';
import type { ApiError } from '@occ/contracts';

/** OpenAPI shape of the error body. `implements` keeps it in lockstep with `@occ/contracts`. */
export class ApiErrorDto implements ApiError {
  @ApiProperty({ example: 404 })
  statusCode: number;

  @ApiProperty({ description: 'HTTP status name', example: 'NOT_FOUND' })
  error: string;

  @ApiProperty({
    description: 'What went wrong. Validation failures list every problem as an array.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Incident 00000000-0000-0000-0000-000000000000 was not found',
  })
  message: string | string[];

  @ApiProperty({ example: '/api/incidents/00000000-0000-0000-0000-000000000000' })
  path: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;
}
