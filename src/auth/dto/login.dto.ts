import { ApiProperty } from '@nestjs/swagger';
import { IsByteLength, IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { PASSWORD_MAX_BYTES } from './register.dto';

export class LoginDto {
  @ApiProperty({ example: 'ali@example.com' })
  @IsEmail()
  email!: string;

  // No strength rule here, just the bcrypt cap: past 72 bytes bcrypt would
  // ignore the extra input and a longer, different password could still match.
  @ApiProperty({ example: 'secret123' })
  @IsString()
  @IsNotEmpty()
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  })
  password!: string;
}
