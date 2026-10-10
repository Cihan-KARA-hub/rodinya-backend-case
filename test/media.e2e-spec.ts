import { getConnectionToken } from '@nestjs/mongoose';
import { readFileSync } from 'fs';
import { readFile, readdir, rm } from 'fs/promises';
import { Connection, Types } from 'mongoose';
import { join } from 'path';
import request, { Response } from 'supertest';
import { TestApp, createTestApp } from './utils/test-app';

const JPEG = readFileSync(join(__dirname, 'fixtures/photo.jpg'));
const PNG = readFileSync(join(__dirname, 'fixtures/image.png'));
const MAX = 5 * 1024 * 1024;

/** A buffer of `size` bytes that starts with the JPEG magic bytes. */
const jpegOfSize = (size: number) => {
  const buf = Buffer.alloc(size);
  JPEG.copy(buf, 0, 0, Math.min(JPEG.length, size));
  return buf;
};

interface MediaBody {
  id: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  size: number;
  allowedUserIds?: string[];
  createdAt: string;
}

interface MediaPage {
  items: MediaBody[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

describe('Media upload & /media/my (e2e)', () => {
  let testApp: TestApp;
  let alice: { token: string; id: string };
  let bob: { token: string; id: string };

  const http = () => request(testApp.app.getHttpServer());
  const db = () => testApp.app.get<Connection>(getConnectionToken());

  const signUp = async (email: string) => {
    const res = await http()
      .post('/auth/register')
      .send({ email, password: 'secret123' })
      .expect(201);
    const body = res.body as { accessToken: string; user: { id: string } };
    return { token: body.accessToken, id: body.user.id };
  };

  const upload = (
    token: string | undefined,
    data: Buffer,
    filename = 'photo.jpg',
    contentType = 'image/jpeg',
  ) => {
    const req = http().post('/media/upload');
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.attach('file', data, { filename, contentType });
  };

  const my = (token: string, query = '') =>
    http().get(`/media/my${query}`).set('Authorization', `Bearer ${token}`);

  /** Every file currently under UPLOAD_DIR, as `<userId>/<name>`. */
  const filesOnDisk = async (): Promise<string[]> => {
    const out: string[] = [];
    for (const dir of await readdir(testApp.uploadDir)) {
      for (const f of await readdir(join(testApp.uploadDir, dir))) {
        out.push(`${dir}/${f}`);
      }
    }
    return out;
  };

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  beforeEach(async () => {
    alice = await signUp('alice@test.com');
    bob = await signUp('bob@test.com');
  });

  afterEach(async () => {
    for (const c of ['users', 'sessions', 'media']) {
      await db().collection(c).deleteMany({});
    }
    // Empty UPLOAD_DIR so each test (and the "no file left on disk" checks)
    // starts from a clean directory.
    for (const entry of await readdir(testApp.uploadDir)) {
      await rm(join(testApp.uploadDir, entry), {
        recursive: true,
        force: true,
      });
    }
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('POST /media/upload', () => {
    it('stores a JPEG under UPLOAD_DIR/<userId>/<uuid>.jpg and returns it without filePath (201)', async () => {
      const res = await upload(alice.token, JPEG).expect(201);
      const body = res.body as MediaBody;

      expect(Object.keys(body).sort()).toEqual([
        'allowedUserIds',
        'createdAt',
        'fileName',
        'id',
        'mimeType',
        'ownerId',
        'size',
      ]);
      expect(body).toMatchObject({
        ownerId: alice.id,
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: JPEG.length,
        allowedUserIds: [],
      });

      const [stored] = await filesOnDisk();
      expect(stored).toMatch(new RegExp(`^${alice.id}/[0-9a-f-]{36}\\.jpg$`));
      await expect(readFile(join(testApp.uploadDir, stored))).resolves.toEqual(
        JPEG,
      );
    });

    it('keeps a Turkish file name intact', async () => {
      const res = await upload(alice.token, JPEG, 'fotoğraf çekimi.jpg');

      expect(res.status).toBe(201);
      expect((res.body as MediaBody).fileName).toBe('fotoğraf çekimi.jpg');
    });

    it('strips path segments from the file name', async () => {
      const res = await upload(alice.token, JPEG, '../../etc/passwd.jpg');

      expect(res.status).toBe(201);
      expect((res.body as MediaBody).fileName).toBe('passwd.jpg');
    });

    it('accepts a file of exactly 5 MB', async () => {
      const res = await upload(alice.token, jpegOfSize(MAX)).expect(201);

      expect((res.body as MediaBody).size).toBe(MAX);
    });

    describe('rejections never leave a file on disk', () => {
      afterEach(async () => {
        await expect(filesOnDisk()).resolves.toEqual([]);
        await expect(db().collection('media').countDocuments()).resolves.toBe(
          0,
        );
      });

      it('rejects a PNG (400)', async () => {
        const res = await upload(alice.token, PNG, 'image.png', 'image/png');

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
          message: 'File must be a JPEG image',
        });
      });

      it('rejects PNG bytes disguised as a .jpg with image/jpeg (400)', async () => {
        await upload(alice.token, PNG, 'fake.jpg', 'image/jpeg').expect(400);
      });

      it('rejects JPEG bytes declared as another type (400)', async () => {
        await upload(alice.token, JPEG, 'photo.jpg', 'image/png').expect(400);
      });

      it('rejects a file over 5 MB (413)', async () => {
        await upload(alice.token, jpegOfSize(MAX + 1)).expect(413);
      });

      it('rejects a request without a file (400)', async () => {
        await http()
          .post('/media/upload')
          .set('Authorization', `Bearer ${alice.token}`)
          .expect(400);
      });

      it('rejects more than one file (400)', async () => {
        await http()
          .post('/media/upload')
          .set('Authorization', `Bearer ${alice.token}`)
          .attach('file', JPEG, {
            filename: 'a.jpg',
            contentType: 'image/jpeg',
          })
          .attach('file', JPEG, {
            filename: 'b.jpg',
            contentType: 'image/jpeg',
          })
          .expect(400);
      });

      it('rejects a file sent under another field name (400)', async () => {
        await http()
          .post('/media/upload')
          .set('Authorization', `Bearer ${alice.token}`)
          .attach('image', JPEG, {
            filename: 'a.jpg',
            contentType: 'image/jpeg',
          })
          .expect(400);
      });

      it('requires a token (401)', async () => {
        await upload(undefined, JPEG).expect(401);
      });
    });
  });

  describe('GET /media/my', () => {
    const uploadNamed = async (token: string, names: string[]) => {
      for (const name of names) {
        await upload(token, JPEG, name).expect(201);
      }
    };

    it("lists only the caller's own media, newest first", async () => {
      await uploadNamed(alice.token, ['1.jpg', '2.jpg', '3.jpg']);
      await uploadNamed(bob.token, ['bob.jpg']);

      const res = await my(alice.token).expect(200);
      const page = res.body as MediaPage;

      expect(page).toMatchObject({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
      expect(page.items.map((m) => m.fileName)).toEqual([
        '3.jpg',
        '2.jpg',
        '1.jpg',
      ]);
      expect(page.items.every((m) => m.ownerId === alice.id)).toBe(true);
      expect(JSON.stringify(page)).not.toContain('filePath');
    });

    it('pages through the results', async () => {
      await uploadNamed(alice.token, [
        '1.jpg',
        '2.jpg',
        '3.jpg',
        '4.jpg',
        '5.jpg',
      ]);

      const second = (await my(alice.token, '?page=2&limit=2').expect(200))
        .body as MediaPage;

      expect(second).toMatchObject({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
      expect(second.items.map((m) => m.fileName)).toEqual(['3.jpg', '2.jpg']);
    });

    it('returns an empty page for a user without uploads', async () => {
      await uploadNamed(alice.token, ['1.jpg']);

      await my(bob.token)
        .expect(200)
        .expect({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it.each([
      ['page=0', '?page=0'],
      ['limit=0', '?limit=0'],
      ['limit=101', '?limit=101'],
      ['non-numeric limit', '?limit=abc'],
      ['fractional page', '?page=1.5'],
    ])('rejects %s (400)', async (_case, query) => {
      await my(alice.token, query).expect(400);
    });

    it('requires a token (401)', async () => {
      await http().get('/media/my').expect(401);
    });
  });

  describe('GET /media/:id and /media/:id/download', () => {
    let carol: { token: string; id: string };
    let admin: { token: string; id: string };
    let mediaId: string;

    const get = (path: string, token?: string) => {
      const req = http().get(path);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };
    const detail = (token: string, id = mediaId) => get(`/media/${id}`, token);
    const download = (token: string, id = mediaId) =>
      get(`/media/${id}/download`, token)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
    /** Error bodies of download() arrive as raw bytes, like the file would. */
    const errorBody = (res: Response): unknown =>
      Buffer.isBuffer(res.body) ? JSON.parse(res.body.toString()) : res.body;
    const setAllowed = (ids: string[]) =>
      db()
        .collection('media')
        .updateOne(
          { _id: new Types.ObjectId(mediaId) },
          { $set: { allowedUserIds: ids.map((id) => new Types.ObjectId(id)) } },
        );

    beforeEach(async () => {
      carol = await signUp('carol@test.com');
      admin = await signUp('admin@test.com');
      // T7 adds seed:admin; promote directly for now.
      await db()
        .collection('users')
        .updateOne({ email: 'admin@test.com' }, { $set: { role: 'admin' } });

      const res = await upload(alice.token, JPEG, 'fotoğraf "tatil".jpg');
      mediaId = (res.body as MediaBody).id;
      // T6 adds the permissions endpoint; grant bob directly for now.
      await setAllowed([bob.id]);
    });

    describe('who gets in', () => {
      it('lets the owner see the details, including allowedUserIds', async () => {
        const res = await detail(alice.token).expect(200);

        expect(res.body).toMatchObject({
          id: mediaId,
          ownerId: alice.id,
          fileName: 'fotoğraf "tatil".jpg',
          allowedUserIds: [bob.id],
        });
        expect(res.body).not.toHaveProperty('filePath');
      });

      it('lets an allowed user see the details, without allowedUserIds', async () => {
        const res = await detail(bob.token).expect(200);

        expect(res.body).toMatchObject({ id: mediaId });
        expect(res.body).not.toHaveProperty('allowedUserIds');
      });

      it('lets the owner and an allowed user download', async () => {
        await download(alice.token).expect(200);
        await download(bob.token).expect(200);
      });

      it.each([
        ['a stranger', () => carol],
        ['an admin who is neither owner nor allowed (SPEC A3)', () => admin],
      ])('refuses %s with 403', async (_case, who) => {
        const { token } = who();

        for (const res of [await detail(token), await download(token)]) {
          expect(res.status).toBe(403);
          expect(errorBody(res)).toMatchObject({
            message: 'You do not have access to this media',
          });
        }
      });

      it('refuses a user again once removed from the allowed list', async () => {
        await setAllowed([]);

        await detail(bob.token).expect(403);
        await download(bob.token).expect(403);
      });
    });

    describe('ids', () => {
      it('answers 404 for an id that does not exist', async () => {
        const missing = new Types.ObjectId().toString();

        await detail(alice.token, missing).expect(404);
        await download(alice.token, missing).expect(404);
      });

      it.each(['abc', 'aaaaaaaaaaaa', `${'f'.repeat(23)}g`])(
        'answers 400 for the malformed id "%s"',
        async (id) => {
          await detail(alice.token, id).expect(400, {
            message: 'Invalid id',
            error: 'Bad Request',
            statusCode: 400,
          });
          await download(alice.token, id).expect(400);
        },
      );

      it('asks for a token before looking at the id (401, not 400)', async () => {
        await get('/media/abc').expect(401);
      });

      it("keeps '/media/my' routed to the list, not to ':id'", async () => {
        const res = await http()
          .get('/media/my')
          .set('Authorization', `Bearer ${alice.token}`)
          .expect(200);

        expect((res.body as MediaPage).total).toBe(1);
      });
    });

    describe('download', () => {
      let res: Response;

      beforeEach(async () => {
        res = await download(bob.token).expect(200);
      });

      it('returns the exact bytes that were uploaded', () => {
        expect(Buffer.compare(res.body as Buffer, JPEG)).toBe(0);
      });

      it('sends it as a JPEG attachment named after the original file', () => {
        expect(res.headers['content-type']).toBe('image/jpeg');
        expect(res.headers['content-length']).toBe(String(JPEG.length));
        expect(res.headers['content-disposition']).toBe(
          `attachment; filename="foto?raf \\"tatil\\".jpg"; filename*=UTF-8''foto%C4%9Fraf%20%22tatil%22.jpg`,
        );
      });

      it('sends the safety headers', () => {
        expect(res.headers).toMatchObject({
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
          'cache-control': 'private, no-store',
        });
      });

      it('always declares image/jpeg, whatever the original name says', async () => {
        const up = await upload(alice.token, JPEG, 'resim.png').expect(201);

        const png = await download(
          alice.token,
          (up.body as MediaBody).id,
        ).expect(200);

        expect(png.headers['content-type']).toBe('image/jpeg');
        expect(png.headers['content-disposition']).toBe(
          'attachment; filename="resim.png"',
        );
      });

      it('answers 404 when the record exists but its file is gone', async () => {
        for (const file of await filesOnDisk()) {
          await rm(join(testApp.uploadDir, file));
        }

        const gone = await download(alice.token).expect(404);

        expect(errorBody(gone)).toMatchObject({
          message: 'Media file not found',
        });
        // The record itself is still there.
        await detail(alice.token).expect(200);
      });
    });
  });

  it('does not serve stored files statically (404)', async () => {
    await upload(alice.token, JPEG).expect(201);
    const [stored] = await filesOnDisk();

    await http().get(`/uploads/${stored}`).expect(404);
    await http().get(`/${stored}`).expect(404);
  });
});
