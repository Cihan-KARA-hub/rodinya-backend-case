import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { TokenPair } from '../auth.types';

export class TokenPairDto implements TokenPair {
  @ApiProperty({
    description: 'Bearer token for API calls (15 min)',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NzA2ZjFjMmE0YjVlOGQ5ZjAxMjM0NTYifQ.signature',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Used once to get a new token pair via POST /auth/refresh (7 days)',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NzA2ZjFjMmE0YjVlOGQ5ZjAxMjM0NTYifQ.signature',
  })
  refreshToken!: string;
}

export class RegisterResponseDto extends TokenPairDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
