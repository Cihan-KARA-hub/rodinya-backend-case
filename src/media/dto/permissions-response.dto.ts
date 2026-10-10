import { ApiProperty } from '@nestjs/swagger';
import { MediaDocument } from '../schemas/media.schema';

/** Response of GET and POST /media/:id/permissions (owner only). */
export class PermissionsResponseDto {
  @ApiProperty({ example: '6706f1c2a4b5e8d9f0123456' })
  mediaId!: string;

  @ApiProperty({
    type: [String],
    description: 'Users who may view and download this media',
    example: ['6706f1c2a4b5e8d9f0123400'],
  })
  allowedUserIds!: string[];

  static from(media: MediaDocument): PermissionsResponseDto {
    return {
      mediaId: media._id.toString(),
      allowedUserIds: media.allowedUserIds.map((id) => id.toString()),
    };
  }
}
