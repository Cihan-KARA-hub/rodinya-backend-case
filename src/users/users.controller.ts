import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiTooManyRequestsResponse({
  type: ErrorResponseDto,
  description:
    'Rate limit exceeded (100/min per IP and endpoint). See Retry-After.',
})
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'The current user (share your id to get access to media)',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid access token',
  })
  async me(@CurrentUser() current: AuthUser): Promise<UserResponseDto> {
    const user = await this.usersService.findById(current.id);
    // Only if the user was deleted between the guard and this lookup.
    if (!user) throw new UnauthorizedException();
    return UserResponseDto.from(user);
  }
}
