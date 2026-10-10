import { getConnectionToken } from '@nestjs/mongoose';
import { readFileSync } from 'fs';
import { readFile, readdir, rm } from 'fs/promises';
import { Connection } from 'mongoose';
import { join } from 'path';
import request from 'supertest';
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

  it('does not serve stored files statically (404)', async () => {
    await upload(alice.token, JPEG).expect(201);
    const [stored] = await filesOnDisk();

    await http().get(`/uploads/${stored}`).expect(404);
    await http().get(`/${stored}`).expect(404);
  });
});
