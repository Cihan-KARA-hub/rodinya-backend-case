import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { TokenPair } from '../auth.types';

export class TokenPairDto implements TokenPair {
  @ApiProperty({ description: 'Bearer token for API calls (15 min)' })
  accessToken!: string;

  @ApiProperty({ description: 'Used to get a new token pair (7 days)' })
  refreshToken!: string;
}

export class RegisterResponseDto extends TokenPairDto {
  @ApiProperty({ type: UserResponseDto })
  user!: UserResponseDto;
}
