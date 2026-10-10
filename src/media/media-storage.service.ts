import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream, ReadStream } from 'fs';
import { access, mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { EnvVars } from '../config/env.validation';

/**
 * Owns the files under UPLOAD_DIR: `<UPLOAD_DIR>/<userId>/<uuid>.jpg` (SPEC A9).
 * Callers only ever see the relative path, which is stored in Media.filePath.
 */
@Injectable()
export class MediaStorageService implements OnModuleInit {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly root: string;

  constructor(config: ConfigService<EnvVars, true>) {
    this.root = resolve(config.get('UPLOAD_DIR', { infer: true }));
  }

  /** Creates UPLOAD_DIR on startup if it is missing (SPEC A17). */
  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.logger.log(`Storing uploads in ${this.root}`);
  }

  /**
   * Writes an already-validated JPEG and returns its relative path. The name
   * is a fresh UUID, never anything the client sent.
   */
  async save(userId: string, data: Buffer): Promise<string> {
    // The user id becomes a directory name, so it must be a plain 24-hex
    // ObjectId string; nothing else (e.g. '..') may reach the filesystem.
    if (!/^[0-9a-f]{24}$/i.test(userId)) {
      throw new Error(`Invalid owner id for storage: ${userId}`);
    }
    await mkdir(join(this.root, userId), { recursive: true });

    const relativePath = `${userId}/${randomUUID()}.jpg`;
    // 'wx' fails instead of overwriting, should a UUID ever collide.
    await writeFile(this.resolveInside(relativePath), data, { flag: 'wx' });
    return relativePath;
  }

  /** Rejects with ENOENT if the file is gone. */
  async openReadStream(relativePath: string): Promise<ReadStream> {
    const absolute = this.resolveInside(relativePath);
    await access(absolute);
    return createReadStream(absolute);
  }

  /** Idempotent: deleting a file that is already gone is not an error. */
  async delete(relativePath: string): Promise<void> {
    try {
      await unlink(this.resolveInside(relativePath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  /** Resolves a stored path and refuses anything that escapes UPLOAD_DIR. */
  private resolveInside(relativePath: string): string {
    const absolute = resolve(this.root, relativePath);
    if (!absolute.startsWith(this.root + sep)) {
      throw new Error(`Path escapes the upload directory: ${relativePath}`);
    }
    return absolute;
  }
}
