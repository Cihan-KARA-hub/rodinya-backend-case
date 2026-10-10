import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { AuthThrottle } from '../common/decorators/auth-throttle.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { RegisterResponseDto, TokenPairDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

// @Public() is per route, not on the class: logout needs the access token.
@ApiTags('auth')
@ApiTooManyRequestsResponse({
  type: ErrorResponseDto,
  description:
    'Rate limit exceeded (100/min per IP and endpoint; 10/min on register, login and refresh). See Retry-After.',
})
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @AuthThrottle()
  @Post('register')
  @ApiOperation({
    summary: 'Create an account; returns the user and a token pair',
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid email or weak password',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: 'Email is already registered',
  })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const { user, ...tokens } = await this.authService.register(
      dto.email,
      dto.password,
    );
    return { user: UserResponseDto.from(user), ...tokens };
  }

  @Public()
  @AuthThrottle()
  @Post('login')
  @ApiOperation({ summary: 'Log in; returns an access and a refresh token' })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenPairDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Malformed body',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Invalid email or password',
  })
  login(@Body() dto: LoginDto): Promise<TokenPairDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @AuthThrottle()
  @Post('refresh')
  @ApiOperation({
    summary:
      'Exchange a refresh token for a new pair (the old one stops working)',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    type: TokenPairDto,
    description: 'New pair; the refresh token sent is no longer valid',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'refreshToken missing or empty',
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description:
      'Invalid, expired or already-used refresh token (reuse also closes the session)',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenPairDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Log out this device: its tokens stop working' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiNoContentResponse({
    description: "This device's session is closed; its tokens stop working",
  })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'Missing or invalid access token',
  })
  logout(@CurrentUser() user: AuthUser): Promise<void> {
    return this.authService.logout(user.sessionId);
  }
}
