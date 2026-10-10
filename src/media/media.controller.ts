import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  Post,
  Query,
  Res,
  StreamableFile,
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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import type { Response } from 'express';
import { Types } from 'mongoose';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { MediaPageDto, MediaResponseDto } from './dto/media-response.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { PermissionsResponseDto } from './dto/permissions-response.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { MediaService } from './media.service';
import { JpegFileValidator } from './validators/jpeg-file.validator';

/**
 * Swagger docs shared by every `/media/:id...` route. `type: String` is needed:
 * the handler param is typed Types.ObjectId (what the pipe returns), and
 * without it Swagger documents an object, which Swagger UI shows as a large
 * empty JSON box instead of a plain text field.
 */
const ApiMediaId = () =>
  ApiParam({
    name: 'id',
    type: String,
    description:
      'Media id: the `id` returned by upload or /media/my (24 hex characters)',
    example: '6706f1c2a4b5e8d9f0123456',
  });

/**
 * Sent with every download. The file is only ever a JPEG to save, never a page:
 * nosniff stops a browser from treating a JPEG/HTML polyglot as HTML, and the
 * CSP sandbox keeps any script in it from running if it is opened anyway.
 */
const DOWNLOAD_HEADERS = {
  'Content-Type': 'image/jpeg',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  // Access-controlled content: no shared/proxy caching, nothing kept on disk.
  'Cache-Control': 'private, no-store',
};

@ApiTags('media')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  type: ErrorResponseDto,
  description: 'Missing or invalid access token',
})
@ApiTooManyRequestsResponse({
  type: ErrorResponseDto,
  description:
    'Rate limit exceeded (100/min per IP and endpoint). See Retry-After.',
})
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Multer (configured in MediaModule) keeps the file in memory and enforces
   * MAX_FILE_SIZE (413) and a single file; ParseFilePipe then requires the
   * file (400) and checks it is a real JPEG (400) before anything hits disk.
   */
  @Post('upload')
  @ApiOperation({ summary: 'Upload a JPEG (max 5 MB)' })
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
    type: ErrorResponseDto,
    description: 'No file, more than one file, or not a JPEG',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorResponseDto,
    description: 'File larger than 5 MB',
  })
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

  // Must stay declared before the ':id' routes, or '/media/my' would match ':id'
  // and be rejected by ParseObjectIdPipe as an invalid id.
  @Get('my')
  @ApiOperation({ summary: 'List my own media, newest first (paginated)' })
  @ApiOkResponse({
    type: MediaPageDto,
    description: "Only the caller's own media, newest first",
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'Invalid page or limit',
  })
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

  @Get(':id')
  @ApiOperation({ summary: 'Media details (owner or allowed user)' })
  @ApiMediaId()
  @ApiOkResponse({ type: MediaResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Neither the owner nor an allowed user',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Media not found',
  })
  async findOne(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<MediaResponseDto> {
    const media = await this.mediaService.findForViewer(id, user.id);
    return MediaResponseDto.from(media, user);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download the original file (owner or allowed user)',
  })
  @ApiMediaId()
  // The JPEG type goes on the 200 response only: @ApiProduces would also label
  // the JSON error bodies (400/403/404) as image/jpeg.
  @ApiOkResponse({
    description:
      'The original JPEG as an attachment, named after the original file',
    content: {
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Neither the owner nor an allowed user',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Media (or its file) not found',
  })
  async download(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const media = await this.mediaService.findForViewer(id, user.id);
    const { stream, size } = await this.mediaService.openFile(media);

    // Express builds an RFC 6266 Content-Disposition: an ASCII fallback plus
    // filename*=UTF-8''... for names like "fotoğraf.jpg", with quotes and
    // control characters escaped. It also guesses Content-Type from the name,
    // which DOWNLOAD_HEADERS then overrides: the bytes are always a JPEG.
    res.attachment(media.fileName);
    res.set(DOWNLOAD_HEADERS);
    return new StreamableFile(stream, { length: size });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete media and its file (owner only)' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiMediaId()
  @ApiNoContentResponse({ description: 'Record and file deleted' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Not the owner (allowed users may only view)',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Media not found',
  })
  remove(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.mediaService.delete(id, user.id);
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: 'Who may view this media (owner only)' })
  @ApiMediaId()
  @ApiOkResponse({ type: PermissionsResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid id' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Not the owner',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Media not found',
  })
  async permissions(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<PermissionsResponseDto> {
    const media = await this.mediaService.findForOwner(id, user.id);
    return PermissionsResponseDto.from(media);
  }

  @Post(':id/permissions')
  @ApiOperation({ summary: 'Grant or revoke view access (owner only)' })
  @HttpCode(HttpStatus.OK)
  @ApiMediaId()
  @ApiOkResponse({
    type: PermissionsResponseDto,
    description: 'The updated list; add and remove are idempotent',
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'Invalid id, userId or action, or the owner targeting themselves',
  })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'Not the owner',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description: 'Media not found, or (on add) user not found',
  })
  async updatePermissions(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdatePermissionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PermissionsResponseDto> {
    const media = await this.mediaService.updatePermissions(
      id,
      user.id,
      dto.userId,
      dto.action,
    );
    return PermissionsResponseDto.from(media);
  }
}
