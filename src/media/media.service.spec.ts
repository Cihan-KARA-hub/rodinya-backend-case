import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaModule } from './media.module';
import { MediaService } from './media.service';
import { Media } from './schemas/media.schema';

// Real (in-memory) mongod and a real temp UPLOAD_DIR: the file/record
// consistency rules are only meaningful against both.
describe('MediaService', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: MediaService;
  let mediaModel: Model<Media>;
  let uploadDir: string;

  const owner = new Types.ObjectId().toString();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
  const upload = (overrides: Partial<Express.Multer.File> = {}) =>
    ({
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      buffer: jpeg,
      size: jpeg.length,
      ...overrides,
    }) as Express.Multer.File;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    uploadDir = await mkdtemp(join(tmpdir(), 'media-service-'));
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), MediaModule],
    })
      .useMocker((token) => {
        if (token !== ConfigService) return undefined;
        const env: Record<string, unknown> = {
          UPLOAD_DIR: uploadDir,
          MAX_FILE_SIZE: 5 * 1024 * 1024,
        };
        return { get: (key: string) => env[key] };
      })
      .compile();
    await moduleRef.init(); // runs onModuleInit (creates UPLOAD_DIR)
    service = moduleRef.get(MediaService);
    mediaModel = moduleRef.get(getModelToken(Media.name));
  });

  afterEach(async () => {
    await mediaModel.deleteMany({});
    await rm(join(uploadDir, owner), { recursive: true, force: true });
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
    await rm(uploadDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it("writes the file in the owner's folder and records it", async () => {
      const media = await service.create(owner, upload());

      expect(media.toObject()).toMatchObject({
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: jpeg.length,
        allowedUserIds: [],
      });
      expect(media.ownerId.toString()).toBe(owner);
      expect(media.filePath).toMatch(
        new RegExp(`^${owner}/[0-9a-f-]{36}\\.jpg$`),
      );
      await expect(readFile(join(uploadDir, media.filePath))).resolves.toEqual(
        jpeg,
      );
    });

    it('stores the sanitized original name', async () => {
      const media = await service.create(
        owner,
        upload({ originalname: '../../fotoğraf\r\n.jpg' }),
      );

      expect(media.fileName).toBe('fotoğraf.jpg');
    });

    it('takes the size from the bytes actually received', async () => {
      const media = await service.create(owner, upload({ size: 999_999 }));

      expect(media.size).toBe(jpeg.length);
    });

    it('removes the written file when the record cannot be saved', async () => {
      // A missing mimetype fails schema validation after the file is written.
      await expect(
        service.create(owner, upload({ mimetype: undefined })),
      ).rejects.toThrow();

      await expect(readdir(join(uploadDir, owner))).resolves.toEqual([]);
      await expect(mediaModel.countDocuments()).resolves.toBe(0);
    });
  });

  describe('findByOwner', () => {
    const uploadMany = async (n: number, ownerId = owner) => {
      const created = [];
      for (let i = 0; i < n; i++) {
        created.push(
          await service.create(ownerId, upload({ originalname: `${i}.jpg` })),
        );
      }
      return created;
    };

    it("returns only the owner's media, newest first", async () => {
      await uploadMany(3);
      const stranger = new Types.ObjectId().toString();
      await uploadMany(2, stranger);

      const { items, total } = await service.findByOwner(owner, 1, 20);

      expect(total).toBe(3);
      expect(items.map((m) => m.fileName)).toEqual(['2.jpg', '1.jpg', '0.jpg']);
      expect(items.every((m) => m.ownerId.toString() === owner)).toBe(true);
    });

    it('pages without overlap or gaps', async () => {
      await uploadMany(5);

      const first = await service.findByOwner(owner, 1, 2);
      const second = await service.findByOwner(owner, 2, 2);
      const third = await service.findByOwner(owner, 3, 2);

      expect(first.total).toBe(5);
      expect(
        [...first.items, ...second.items, ...third.items].map(
          (m) => m.fileName,
        ),
      ).toEqual(['4.jpg', '3.jpg', '2.jpg', '1.jpg', '0.jpg']);
      expect(third.items).toHaveLength(1);
    });

    it('returns an empty page past the end, with the real total', async () => {
      await uploadMany(2);

      await expect(service.findByOwner(owner, 5, 20)).resolves.toMatchObject({
        items: [],
        total: 2,
      });
    });

    it('returns nothing for a user without uploads', async () => {
      await expect(
        service.findByOwner(new Types.ObjectId().toString(), 1, 20),
      ).resolves.toEqual({ items: [], total: 0 });
    });
  });

  describe('findForViewer', () => {
    const allowed = new Types.ObjectId().toString();
    const stranger = new Types.ObjectId().toString();
    let mediaId: Types.ObjectId;

    beforeEach(async () => {
      const media = await service.create(owner, upload());
      mediaId = media._id;
      // T6 adds the permissions endpoint; until then, grant directly.
      await mediaModel.updateOne(
        { _id: mediaId },
        { $set: { allowedUserIds: [new Types.ObjectId(allowed)] } },
      );
    });

    it('returns the record to its owner', async () => {
      const media = await service.findForViewer(mediaId, owner);

      expect(media._id.equals(mediaId)).toBe(true);
    });

    it('returns the record to a user the owner allowed', async () => {
      await expect(
        service.findForViewer(mediaId, allowed),
      ).resolves.toBeDefined();
    });

    it('refuses anyone else with 403, admins included (no role check)', async () => {
      // The service never sees a role: an admin is just another user id here.
      await expect(service.findForViewer(mediaId, stranger)).rejects.toThrow(
        new ForbiddenException('You do not have access to this media'),
      );
    });

    it('stops working for a user once removed from the allowed list', async () => {
      await mediaModel.updateOne(
        { _id: mediaId },
        { $set: { allowedUserIds: [] } },
      );

      await expect(service.findForViewer(mediaId, allowed)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('answers 404 before 403 for a missing record', async () => {
      await expect(
        service.findForViewer(new Types.ObjectId(), stranger),
      ).rejects.toThrow(new NotFoundException('Media not found'));
    });
  });
});
