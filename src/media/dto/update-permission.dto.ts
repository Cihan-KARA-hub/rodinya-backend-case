import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';
import { OBJECT_ID_PATTERN } from '../../common/utils/object-id';
import type { PermissionAction } from '../media.service';

const ACTIONS: PermissionAction[] = ['add', 'remove'];

/** Body of POST /media/:id/permissions (SPEC A11). */
export class UpdatePermissionDto {
  @ApiProperty({
    description:
      'Id of the user to grant or revoke view access (see GET /users/me)',
    example: '6706f1c2a4b5e8d9f0123456',
  })
  @IsString()
  @Matches(OBJECT_ID_PATTERN, {
    message: 'userId must be a 24-character hex id',
  })
  userId!: string;

  @ApiProperty({ enum: ACTIONS, example: 'add' })
  @IsIn(ACTIONS)
  action!: PermissionAction;
}
