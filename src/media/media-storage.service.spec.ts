import { ConfigService } from '@nestjs/config';
import { EnvVars } from '../config/env.validation';
import { ReadStream, existsSync } from 'fs';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { Types } from 'mongoose';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaStorageService } from './media-storage.service';

// Real filesystem in a throwaway directory.
describe('MediaStorageService', () => {
  let tmp: string;
  let root: string;
  let storage: MediaStorageService;
  const userId = new Types.ObjectId().toString();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]);

  const readAll = async (stream: ReadStream): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'media-storage-'));
    root = join(tmp, 'nested', 'uploads'); // does not exist yet
    const config = { get: () => root } as unknown as ConfigService<
      EnvVars,
      true
    >;
    storage = new MediaStorageService(config);
    await storage.onModuleInit();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates UPLOAD_DIR (and missing parents) on startup', () => {
    expect(existsSync(root)).toBe(true);
  });

  describe('save', () => {
    it("writes the bytes to <userId>/<uuid>.jpg in the user's folder", async () => {
      const relativePath = await storage.save(userId, jpeg);

      expect(relativePath).toMatch(
        new RegExp(`^${userId}/[0-9a-f-]{36}\\.jpg$`),
      );
      await expect(readFile(join(root, relativePath))).resolves.toEqual(jpeg);
    });

    it('gives every upload its own name', async () => {
      const a = await storage.save(userId, jpeg);
      const b = await storage.save(userId, jpeg);

      expect(a).not.toBe(b);
      await expect(readdir(join(root, userId))).resolves.toHaveLength(2);
    });

    it.each([
      ['a traversal', '../../etc'],
      ['a 12-char string mongoose would accept', 'aaaaaaaaaaaa'],
      ['empty', ''],
    ])('refuses an owner id that is %s', async (_case, badId) => {
      await expect(storage.save(badId, jpeg)).rejects.toThrow(
        'Invalid owner id',
      );
      await expect(readdir(root)).resolves.toEqual([]);
    });
  });

  describe('openReadStream', () => {
    it('streams the stored bytes back', async () => {
      const relativePath = await storage.save(userId, jpeg);

      const stream = await storage.openReadStream(relativePath);

      await expect(readAll(stream)).resolves.toEqual(jpeg);
    });

    it('rejects with ENOENT when the file is gone', async () => {
      await expect(
        storage.openReadStream(`${userId}/missing.jpg`),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each(['../../secret.txt', '..', `${userId}/../../x.jpg`])(
      'refuses a path that escapes UPLOAD_DIR (%s)',
      async (path) => {
        await expect(storage.openReadStream(path)).rejects.toThrow(
          'escapes the upload directory',
        );
      },
    );
  });

  describe('delete', () => {
    it('removes the file', async () => {
      const relativePath = await storage.save(userId, jpeg);

      await storage.delete(relativePath);

      expect(existsSync(join(root, relativePath))).toBe(false);
    });

    it('does not fail when the file is already gone', async () => {
      await expect(
        storage.delete(`${userId}/missing.jpg`),
      ).resolves.toBeUndefined();
    });

    it('refuses a path that escapes UPLOAD_DIR', async () => {
      await expect(storage.delete('../outside.jpg')).rejects.toThrow(
        'escapes the upload directory',
      );
    });
  });
});
