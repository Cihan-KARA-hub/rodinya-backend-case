import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { RegisterResponseDto, TokenPairDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email or weak password' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    const { user, ...tokens } = await this.authService.register(
      dto.email,
      dto.password,
    );
    return { user: UserResponseDto.from(user), ...tokens };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenPairDto })
  @ApiBadRequestResponse({ description: 'Malformed body' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  login(@Body() dto: LoginDto): Promise<TokenPairDto> {
    return this.authService.login(dto.email, dto.password);
  }
}
