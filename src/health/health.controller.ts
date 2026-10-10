import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOkResponse({ schema: { example: { status: 'ok', db: 'up' } } })
  @ApiServiceUnavailableResponse({ description: 'Database is not connected' })
  check(): { status: 'ok'; db: 'up' } {
    if (this.connection.readyState !== ConnectionStates.connected) {
      throw new ServiceUnavailableException('Database is not connected');
    }
    return { status: 'ok', db: 'up' };
  }
}
