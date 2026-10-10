import { ApiProperty } from '@nestjs/swagger';
import { Role, UserDocument } from '../schemas/user.schema';

/** The public shape of a user (SPEC: `{ id, email, role, createdAt }`). */
export class UserResponseDto {
  @ApiProperty({ example: '6706f1c2a4b5e8d9f0123456' })
  id!: string;

  @ApiProperty({ example: 'ali@example.com' })
  email!: string;

  @ApiProperty({ enum: Role, example: Role.User })
  role!: Role;

  @ApiProperty()
  createdAt!: Date;

  /** Picks fields explicitly, so nothing new on the schema leaks by default. */
  static from(user: UserDocument): UserResponseDto {
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
