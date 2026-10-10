import {
  Controller,
  Get,
  ParseFilePipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MediaPageDto, MediaResponseDto } from './dto/media-response.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { MediaService } from './media.service';
import { JpegFileValidator } from './validators/jpeg-file.validator';

@ApiTags('media')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Multer (configured in MediaModule) keeps the file in memory and enforces
   * MAX_FILE_SIZE (413) and a single file; ParseFilePipe then requires the
   * file (400) and checks it is a real JPEG (400) before anything hits disk.
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'A JPEG image, at most MAX_FILE_SIZE bytes (5 MB)',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: MediaResponseDto })
  @ApiBadRequestResponse({
    description: 'No file, more than one file, or not a JPEG',
  })
  @ApiPayloadTooLargeResponse({ description: 'File larger than 5 MB' })
  async upload(
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [new JpegFileValidator()],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: AuthUser,
  ): Promise<MediaResponseDto> {
    const media = await this.mediaService.create(user.id, file);
    return MediaResponseDto.from(media, user);
  }

  @Get('my')
  @ApiOkResponse({
    type: MediaPageDto,
    description: "Only the caller's own media, newest first",
  })
  @ApiBadRequestResponse({ description: 'Invalid page or limit' })
  async my(
    @Query() { page, limit }: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<MediaPageDto> {
    const { items, total } = await this.mediaService.findByOwner(
      user.id,
      page,
      limit,
    );
    return {
      items: items.map((media) => MediaResponseDto.from(media, user)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
