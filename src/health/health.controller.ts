import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Public()
// Probed by Docker/orchestrators; must never be rate limited (SPEC A16).
@SkipThrottle({ default: true, auth: true })
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness and database status (no auth, not rate limited)',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        db: { type: 'string', example: 'up' },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: 'Database is not connected',
  })
  check(): { status: 'ok'; db: 'up' } {
    if (this.connection.readyState !== ConnectionStates.connected) {
      throw new ServiceUnavailableException('Database is not connected');
    }
    return { status: 'ok', db: 'up' };
  }
}
