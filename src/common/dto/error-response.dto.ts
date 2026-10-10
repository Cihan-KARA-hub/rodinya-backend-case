import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger-only description of Nest's standard error body, returned by every
 * 4xx/5xx in this API (SPEC: `{ statusCode, message, error }`).
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    description:
      'A sentence, or one sentence per failed rule for validation errors',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['password must contain a digit'],
  })
  message!: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;
}
