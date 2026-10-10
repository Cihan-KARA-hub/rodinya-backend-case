import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ReadStream } from 'fs';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, UpdateQuery } from 'mongoose';
import { UsersService } from '../users/users.service';
import { MediaStorageService } from './media-storage.service';
import { Media, MediaDocument } from './schemas/media.schema';
import { sanitizeFileName } from './utils/sanitize-file-name';

export interface MediaPage {
  items: MediaDocument[];
  total: number;
}

export type PermissionAction = 'add' | 'remove';

const NO_ACCESS = 'You do not have access to this media';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @InjectModel(Media.name) private readonly mediaModel: Model<Media>,
    private readonly storage: MediaStorageService,
    private readonly usersService: UsersService,
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
      throw new ForbiddenException(NO_ACCESS);
    }
    return media;
  }

  /**
   * Like findForViewer, but for owner-only operations (SPEC A4): allowed users
   * may only view, so they get 403 here like everyone else.
   *
   * @throws NotFoundException (404) / ForbiddenException (403)
   */
  async findForOwner(
    id: Types.ObjectId,
    ownerId: string,
  ): Promise<MediaDocument> {
    const media = await this.mediaModel.findById(id).exec();
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (!media.ownerId.equals(ownerId)) {
      throw new ForbiddenException(NO_ACCESS);
    }
    return media;
  }

  /**
   * Deletes the record, then its file (SPEC A12). The owner check and the
   * delete are one atomic operation. Record first: if the file cannot be
   * removed, what is left is an orphan file nobody sees, never a listed record
   * whose download fails.
   */
  async delete(id: Types.ObjectId, ownerId: string): Promise<void> {
    const media = await this.mediaModel
      .findOneAndDelete({ _id: id, ownerId })
      .exec();
    if (!media) {
      return this.explainOwnerMiss(id);
    }

    try {
      await this.storage.delete(media.filePath);
    } catch (err) {
      this.logger.error(
        `Media ${id.toString()} deleted but its file ${media.filePath} could not be removed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Grants or revokes view access (SPEC A11). Both are idempotent, and the
   * owner check is part of the same atomic update as the change itself.
   *
   * @throws NotFoundException (404) for a missing media, or a missing user on `add`
   * @throws ForbiddenException (403) if the caller is not the owner
   * @throws BadRequestException (400) if the owner targets themselves
   */
  async updatePermissions(
    id: Types.ObjectId,
    ownerId: string,
    userId: string,
    action: PermissionAction,
  ): Promise<MediaDocument> {
    // Ownership first, so non-owners learn nothing from the checks below.
    await this.findForOwner(id, ownerId);

    if (userId === ownerId) {
      throw new BadRequestException(
        'The owner always has access and cannot be added or removed',
      );
    }
    // Only `add` needs the user to exist; `remove` must still be able to
    // clean up the id of a user who no longer exists.
    if (action === 'add' && !(await this.usersService.findById(userId))) {
      throw new NotFoundException('User not found');
    }

    const target = new Types.ObjectId(userId);
    const update: UpdateQuery<Media> =
      action === 'add'
        ? { $addToSet: { allowedUserIds: target } }
        : { $pull: { allowedUserIds: target } };
    const media = await this.mediaModel
      .findOneAndUpdate({ _id: id, ownerId }, update, { new: true })
      .exec();
    if (!media) {
      // Deleted (or changed hands) between the check and the update.
      return this.explainOwnerMiss(id);
    }
    return media;
  }

  /**
   * After an owner-filtered write matched nothing: 404 if the record is gone,
   * 403 if it exists but belongs to someone else.
   */
  private async explainOwnerMiss(id: Types.ObjectId): Promise<never> {
    const exists = await this.mediaModel.exists({ _id: id }).exec();
    throw exists
      ? new ForbiddenException(NO_ACCESS)
      : new NotFoundException('Media not found');
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
