import { getConnectionToken } from '@nestjs/mongoose';
import { readFileSync } from 'fs';
import { Connection } from 'mongoose';
import { join } from 'path';
import request from 'supertest';
import { SessionsService } from '../src/auth/sessions/sessions.service';
import { AdminSeeder } from '../src/database/seeds/admin.seeder';
import { UsersService } from '../src/users/users.service';
import { TestApp, createTestApp } from './utils/test-app';

const JPEG = readFileSync(join(__dirname, 'fixtures/photo.jpg'));
const ADMIN = { email: 'admin@test.com', password: 'Admin123' };

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * SPEC A3: the admin role exists and is created by the seed, but grants no
 * rights over media. An admin is an ordinary user towards other people's files.
 */
describe('Admin (e2e)', () => {
  let testApp: TestApp;
  let seeder: AdminSeeder;
  let admin: { token: string; id: string };
  let alice: { token: string; id: string };
  let aliceMedia: string;

  const http = () => request(testApp.app.getHttpServer());
  const db = () => testApp.app.get<Connection>(getConnectionToken());
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password });
  const as = (token: string) => ({
    get: (path: string) =>
      http().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string, body: object) =>
      http().post(path).set('Authorization', `Bearer ${token}`).send(body),
    del: (path: string) =>
      http().delete(path).set('Authorization', `Bearer ${token}`),
    upload: () =>
      http()
        .post('/media/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', JPEG, {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        }),
  });

  beforeAll(async () => {
    testApp = await createTestApp();
    // The same seeder `npm run seed:admin` runs, against this app's database.
    seeder = new AdminSeeder(
      testApp.app.get(UsersService),
      testApp.app.get(SessionsService),
    );
  });

  beforeEach(async () => {
    await seeder.run(ADMIN.email, ADMIN.password);
    const tokens = (await login(ADMIN.email, ADMIN.password).expect(200))
      .body as Tokens;
    const me = await as(tokens.accessToken).get('/users/me').expect(200);
    admin = { token: tokens.accessToken, id: (me.body as { id: string }).id };

    const reg = await http()
      .post('/auth/register')
      .send({ email: 'alice@test.com', password: 'secret123' })
      .expect(201);
    const body = reg.body as Tokens & { user: { id: string } };
    alice = { token: body.accessToken, id: body.user.id };
    aliceMedia = (
      (await as(alice.token).upload().expect(201)).body as {
        id: string;
      }
    ).id;
  });

  afterEach(async () => {
    for (const c of ['users', 'sessions', 'media']) {
      await db().collection(c).deleteMany({});
    }
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('the seeded account', () => {
    it('can log in and is shown as admin', async () => {
      await as(admin.token)
        .get('/users/me')
        .expect(200)
        .expect((res) => {
          expect(res.body).toMatchObject({
            email: ADMIN.email,
            role: 'admin',
          });
        });
    });

    it('carries role admin in its access token', () => {
      const payload = JSON.parse(
        Buffer.from(admin.token.split('.')[1], 'base64url').toString(),
      ) as { role: string };

      expect(payload.role).toBe('admin');
    });

    it('logs the admin out everywhere when the seed resets the password', async () => {
      await seeder.run(ADMIN.email, 'NewAdmin456');

      await as(admin.token).get('/users/me').expect(401);
      await login(ADMIN.email, ADMIN.password).expect(401);
      await login(ADMIN.email, 'NewAdmin456').expect(200);
    });
  });

  describe("someone else's media: no global rights (403 everywhere)", () => {
    it.each([
      ['GET /media/:id', () => as(admin.token).get(`/media/${aliceMedia}`)],
      [
        'GET /media/:id/download',
        () => as(admin.token).get(`/media/${aliceMedia}/download`),
      ],
      ['DELETE /media/:id', () => as(admin.token).del(`/media/${aliceMedia}`)],
      [
        'GET /media/:id/permissions',
        () => as(admin.token).get(`/media/${aliceMedia}/permissions`),
      ],
      [
        'POST /media/:id/permissions',
        () =>
          as(admin.token).post(`/media/${aliceMedia}/permissions`, {
            userId: admin.id,
            action: 'add',
          }),
      ],
    ])('%s → 403', async (_route, send) => {
      await send().expect(403);
    });

    it("does not list others' media in /media/my", async () => {
      const res = await as(admin.token).get('/media/my').expect(200);

      expect(res.body).toMatchObject({ total: 0, items: [] });
    });

    it('leaves the media untouched after all attempts', async () => {
      await as(admin.token).del(`/media/${aliceMedia}`).expect(403);
      await as(admin.token)
        .post(`/media/${aliceMedia}/permissions`, {
          userId: admin.id,
          action: 'add',
        })
        .expect(403);

      await as(alice.token)
        .get(`/media/${aliceMedia}/permissions`)
        .expect(200, { mediaId: aliceMedia, allowedUserIds: [] });
    });
  });

  describe('like any user', () => {
    it('can view (only view) what the owner shared with it', async () => {
      await as(alice.token)
        .post(`/media/${aliceMedia}/permissions`, {
          userId: admin.id,
          action: 'add',
        })
        .expect(200);

      await as(admin.token).get(`/media/${aliceMedia}`).expect(200);
      await as(admin.token).get(`/media/${aliceMedia}/download`).expect(200);
      await as(admin.token).del(`/media/${aliceMedia}`).expect(403);
      await as(admin.token).get(`/media/${aliceMedia}/permissions`).expect(403);
    });

    it('has full owner rights over its own uploads', async () => {
      const own = (
        (await as(admin.token).upload().expect(201)).body as {
          id: string;
        }
      ).id;

      await as(admin.token)
        .post(`/media/${own}/permissions`, { userId: alice.id, action: 'add' })
        .expect(200, { mediaId: own, allowedUserIds: [alice.id] });
      await as(alice.token).get(`/media/${own}/download`).expect(200);
      await as(admin.token).del(`/media/${own}`).expect(204);
    });
  });
});
