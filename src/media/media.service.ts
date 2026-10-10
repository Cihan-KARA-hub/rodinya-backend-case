import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MediaStorageService } from './media-storage.service';
import { Media, MediaDocument } from './schemas/media.schema';
import { sanitizeFileName } from './utils/sanitize-file-name';

export interface MediaPage {
  items: MediaDocument[];
  total: number;
}

@Injectable()
export class MediaService {
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
