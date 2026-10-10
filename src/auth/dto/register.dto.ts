import { ApiProperty } from '@nestjs/swagger';
import {
  IsByteLength,
  IsEmail,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * bcrypt only reads the first 72 bytes of a password and silently ignores the
 * rest. Bytes, not characters: 'ğ' or 'ş' take two bytes in UTF-8.
 */
export const PASSWORD_MAX_BYTES = 72;

export class RegisterDto {
  @ApiProperty({ example: 'ali@example.com' })
  @IsEmail()
  email!: string;

  // SPEC A13: at least 8 characters, at least one letter and one digit.
  @ApiProperty({
    example: 'secret123',
    minLength: 8,
    description: `At least 8 characters with a letter and a digit; at most ${PASSWORD_MAX_BYTES} bytes.`,
  })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, PASSWORD_MAX_BYTES, {
    message: `password must be at most ${PASSWORD_MAX_BYTES} bytes`,
  })
  @Matches(/\p{L}/u, { message: 'password must contain a letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  password!: string;
}
