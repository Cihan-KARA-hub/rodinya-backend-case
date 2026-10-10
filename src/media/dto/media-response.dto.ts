import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuthUser } from '../../auth/auth.types';
import { Role } from '../../users/schemas/user.schema';
import { MediaDocument } from '../schemas/media.schema';

/** Public shape of a media record. `filePath` is never part of it (SPEC A9). */
export class MediaResponseDto {
  @ApiProperty({ example: '6706f1c2a4b5e8d9f0123456' })
  id!: string;

  @ApiProperty({ example: '6706f1c2a4b5e8d9f0123400' })
  ownerId!: string;

  @ApiProperty({ example: 'fotoğraf.jpg' })
  fileName!: string;

  @ApiProperty({ example: 'image/jpeg' })
  mimeType!: string;

  @ApiProperty({ description: 'Size in bytes', example: 248133 })
  size!: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Only shown to the owner and to admins (SPEC A10)',
  })
  allowedUserIds?: string[];

  @ApiProperty()
  createdAt!: Date;

  /** Picks fields explicitly; `viewer` decides whether allowedUserIds is shown. */
  static from(media: MediaDocument, viewer: AuthUser): MediaResponseDto {
    const ownerId = media.ownerId.toString();
    const dto: MediaResponseDto = {
      id: media._id.toString(),
      ownerId,
      fileName: media.fileName,
      mimeType: media.mimeType,
      size: media.size,
      createdAt: media.createdAt,
    };
    if (viewer.id === ownerId || viewer.role === Role.Admin) {
      dto.allowedUserIds = media.allowedUserIds.map((id) => id.toString());
    }
    return dto;
  }
}

export class MediaPageDto {
  @ApiProperty({ type: [MediaResponseDto] })
  items!: MediaResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ description: 'Total records across all pages', example: 57 })
  total!: number;

  @ApiProperty({ example: 3 })
  totalPages!: number;
}
