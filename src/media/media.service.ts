import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReadStream } from 'fs';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MediaStorageService } from './media-storage.service';
import { Media, MediaDocument } from './schemas/media.schema';
import { sanitizeFileName } from './utils/sanitize-file-name';

export interface MediaPage {
  items: MediaDocument[];
  total: number;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectModel(Media.name) private readonly mediaModel: Model<Media>,
    private readonly storage: MediaStorageService,
  ) {}

  /**
   * Stores an upload that already passed JPEG validation. File first, then the
   * record; if the record fails the file is removed, so there is never a record
   * without a file nor (on this path) a file without a record (SPEC A9).
   */
  async create(
    ownerId: string,
    file: Express.Multer.File,
  ): Promise<MediaDocument> {
    const filePath = await this.storage.save(ownerId, file.buffer);
    try {
      return await this.mediaModel.create({
        ownerId,
        fileName: sanitizeFileName(file.originalname),
        filePath,
        mimeType: file.mimetype,
        size: file.buffer.length,
      });
    } catch (err) {
      await this.storage.delete(filePath);
      throw err;
    }
  }

  /**
   * The single place that decides who may see a media record (SPEC A3, A4, A6):
   * only its owner and the users the owner allowed. Roles play no part; an
   * admin who is neither gets 403 like anyone else.
   *
   * @throws NotFoundException (404) if there is no such record.
   * @throws ForbiddenException (403) if the viewer is neither owner nor allowed.
   */
  async findForViewer(
    id: Types.ObjectId,
    viewerId: string,
  ): Promise<MediaDocument> {
    const media = await this.mediaModel.findById(id).exec();
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    const isOwner = media.ownerId.equals(viewerId);
    const isAllowed = media.allowedUserIds.some((userId) =>
      userId.equals(viewerId),
    );
    if (!isOwner && !isAllowed) {
      throw new ForbiddenException('You do not have access to this media');
    }
    return media;
  }

  /**
   * Opens the file of a record the caller was already allowed to see. A record
   * whose file is missing is a data inconsistency (deleted by hand, lost
   * volume): logged as an error, answered with 404 rather than 500.
   */
  async openFile(
    media: MediaDocument,
  ): Promise<{ stream: ReadStream; size: number }> {
    try {
      return await this.storage.open(media.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.logger.error(
        `Media ${media._id.toString()} has no file at ${media.filePath}`,
      );
      throw new NotFoundException('Media file not found');
    }
  }

  /** The owner's own media, newest first (SPEC A5). */
  async findByOwner(
    ownerId: string,
    page: number,
    limit: number,
  ): Promise<MediaPage> {
    const filter = { ownerId };
    const [items, total] = await Promise.all([
      this.mediaModel
        .find(filter)
        // _id breaks ties between uploads in the same millisecond, so pages
        // never overlap or skip records.
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.mediaModel.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}
