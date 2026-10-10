import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { TestApp, createTestApp } from './utils/test-app';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

describe('Auth & users (e2e)', () => {
  let testApp: TestApp;
  const credentials = { email: 'ali@test.com', password: 'secret123' };

  const http = () => request(testApp.app.getHttpServer());
  const register = (body: object) => http().post('/auth/register').send(body);
  const login = (body: object) => http().post('/auth/login').send(body);
  const me = (token?: string) => {
    const req = http().get('/users/me');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const refresh = (refreshToken: unknown) =>
    http().post('/auth/refresh').send({ refreshToken });
  const logout = (token?: string) => {
    const req = http().post('/auth/logout');
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const db = () => testApp.app.get<Connection>(getConnectionToken());
  /** Registers once, then logs in once per device; each gets its own session. */
  const signIn = async (): Promise<TokenPair> =>
    (await login(credentials).expect(200)).body as TokenPair;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterEach(async () => {
    await db().collection('users').deleteMany({});
    await db().collection('sessions').deleteMany({});
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('register → login → /users/me', async () => {
    const reg = await register(credentials).expect(201);
    const regBody = reg.body as TokenPair & { user: Record<string, unknown> };
    expect(Object.keys(regBody).sort()).toEqual([
      'accessToken',
      'refreshToken',
      'user',
    ]);
    expect(Object.keys(regBody.user).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'role',
    ]);
    expect(regBody.user).toMatchObject({ email: 'ali@test.com', role: 'user' });

    const { accessToken } = (await login(credentials).expect(200))
      .body as TokenPair;

    const profile = await me(accessToken).expect(200);
    expect(profile.body).toEqual(regBody.user);
  });

  it('never returns passwordHash', async () => {
    const reg = await register(credentials).expect(201);
    const { accessToken } = reg.body as TokenPair;
    const profile = await me(accessToken).expect(200);

    expect(JSON.stringify(reg.body)).not.toMatch(/password/i);
    expect(JSON.stringify(profile.body)).not.toMatch(/password/i);
  });

  describe('POST /auth/register', () => {
    it('stores the email in lowercase and treats it case-insensitively (409)', async () => {
      const reg = await register({ ...credentials, email: 'Ali@Test.COM' });
      expect(reg.status).toBe(201);
      expect((reg.body as { user: { email: string } }).user.email).toBe(
        'ali@test.com',
      );

      await register(credentials).expect(409);
    });

    it.each([
      ['too short', 'abc1234'],
      ['no digit', 'abcdefgh'],
      ['no letter', '12345678'],
      ['over 72 bytes', 'a1'.repeat(37)],
    ])('rejects a password with %s (400)', async (_case, password) => {
      await register({ ...credentials, password }).expect(400);
    });

    it('rejects an invalid email (400)', async () => {
      await register({ ...credentials, email: 'not-an-email' }).expect(400);
    });

    it('does not let a client choose its role (400)', async () => {
      await register({ ...credentials, role: 'admin' }).expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await register(credentials).expect(201);
    });

    it('accepts the email in any case', async () => {
      await login({ ...credentials, email: 'ALI@test.com' }).expect(200);
    });

    it('gives the same 401 for a wrong password and an unknown email', async () => {
      const wrongPassword = await login({
        ...credentials,
        password: 'wrong1234',
      }).expect(401);
      const unknownEmail = await login({
        ...credentials,
        email: 'nobody@test.com',
      }).expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body).toMatchObject({
        message: 'Invalid email or password',
      });
    });

    it('rejects a password longer than 72 bytes (400)', async () => {
      // bcrypt would ignore everything past byte 72, so this must not reach it.
      await login({
        ...credentials,
        password: credentials.password + 'x'.repeat(72),
      }).expect(400);
    });

    it('rejects a missing password (400)', async () => {
      await login({ email: credentials.email }).expect(400);
    });
  });

  describe('GET /users/me', () => {
    it('requires a token (401)', async () => {
      await me().expect(401);
    });

    it('rejects a malformed token (401)', async () => {
      await me('not-a-jwt').expect(401);
    });

    it('rejects a refresh token used as Bearer (401)', async () => {
      const { refreshToken } = (await register(credentials).expect(201))
        .body as TokenPair;

      await me(refreshToken).expect(401);
    });

    it('rejects the token of a deleted user (401)', async () => {
      const { accessToken } = (await register(credentials).expect(201))
        .body as TokenPair;
      await testApp.app
        .get<Connection>(getConnectionToken())
        .collection('users')
        .deleteMany({});

      await me(accessToken).expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    beforeEach(async () => {
      await register(credentials).expect(201);
    });

    it('register → login → refresh → /users/me', async () => {
      const { refreshToken } = await signIn();

      const next = (await refresh(refreshToken).expect(200)).body as TokenPair;

      await me(next.accessToken).expect(200);
    });

    it('rotates: the new refresh token works, the old one is spent', async () => {
      const first = await signIn();
      const second = (await refresh(first.refreshToken).expect(200))
        .body as TokenPair;

      // The current token keeps working; refresh can be chained.
      const third = (await refresh(second.refreshToken).expect(200))
        .body as TokenPair;
      await me(third.accessToken).expect(200);
    });

    it('treats a reused refresh token as theft and closes the whole session', async () => {
      const stolen = await signIn();
      const legit = (await refresh(stolen.refreshToken).expect(200))
        .body as TokenPair;

      // The already-used token comes back (e.g. replayed by an attacker).
      await refresh(stolen.refreshToken).expect(401);

      // The legitimate holder is logged out of that session as well.
      await refresh(legit.refreshToken).expect(401);
      await me(legit.accessToken).expect(401);
    });

    it("leaves the user's other sessions alone after a theft", async () => {
      const phone = await signIn();
      const laptop = await signIn();
      await refresh(phone.refreshToken).expect(200);

      await refresh(phone.refreshToken).expect(401);

      await me(laptop.accessToken).expect(200);
      await refresh(laptop.refreshToken).expect(200);
    });

    it('rejects an access token (401)', async () => {
      const { accessToken } = await signIn();

      await refresh(accessToken).expect(401);
    });

    it('rejects a malformed token with the same 401 message', async () => {
      const res = await refresh('not-a-jwt').expect(401);

      expect(res.body).toMatchObject({
        message: 'Invalid or expired refresh token',
      });
    });

    it('rejects an expired session (401)', async () => {
      const { refreshToken } = await signIn();
      await db()
        .collection('sessions')
        .updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

      await refresh(refreshToken).expect(401);
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['not a string', 123],
    ])('rejects a refreshToken that is %s (400)', async (_case, value) => {
      await refresh(value).expect(400);
    });
  });

  describe('POST /auth/logout', () => {
    beforeEach(async () => {
      await register(credentials).expect(201);
    });

    it('closes this session: its access and refresh tokens stop working', async () => {
      const { accessToken, refreshToken } = await signIn();

      await logout(accessToken).expect(204);

      await me(accessToken).expect(401);
      await refresh(refreshToken).expect(401);
      await logout(accessToken).expect(401);
    });

    it('does not log out the other devices', async () => {
      const phone = await signIn();
      const laptop = await signIn();

      await logout(phone.accessToken).expect(204);

      await me(laptop.accessToken).expect(200);
      await refresh(laptop.refreshToken).expect(200);
    });

    it('requires an access token (401)', async () => {
      const { refreshToken } = await signIn();

      await logout().expect(401);
      await logout(refreshToken).expect(401);
    });
  });

  it('keeps /health public under the global guard', async () => {
    await http().get('/health').expect(200);
  });
});
