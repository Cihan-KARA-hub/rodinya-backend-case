import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  // Only the shape is checked here (400); whether the token is valid is the
  // service's call, and every invalid token gets the same 401.
  @ApiProperty({
    description: 'The refreshToken from login, register or a previous refresh',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NzA2ZjFjMmE0YjVlOGQ5ZjAxMjM0NTYifQ.signature',
  })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
