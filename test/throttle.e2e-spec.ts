import request from 'supertest';
import { TestApp, createTestApp } from './utils/test-app';

const AUTH_LIMIT = 3;
const LIMIT = 5;
const LOW_LIMITS = {
  THROTTLE_AUTH_LIMIT: String(AUTH_LIMIT),
  THROTTLE_LIMIT: String(LIMIT),
};

const TOO_MANY = {
  statusCode: 429,
  message: 'Too many requests, please try again later',
  error: 'Too Many Requests',
};

/**
 * SPEC A16 with low limits. Each test gets a fresh app, so it starts with
 * empty counters (they live in memory); booting one (with its in-memory
 * mongod) takes a few seconds, hence the longer timeout.
 */
jest.setTimeout(30_000);

describe('Rate limiting (e2e)', () => {
  let testApp: TestApp;
  const http = () => request(testApp.app.getHttpServer());
  const badLogin = (forwardedFor?: string) => {
    const req = http()
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'secret123' });
    return forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req;
  };

  afterEach(async () => {
    await testApp?.close();
  });

  describe('with TRUST_PROXY off (default)', () => {
    beforeEach(async () => {
      testApp = await createTestApp(LOW_LIMITS);
    });

    it(`allows ${AUTH_LIMIT} login attempts per minute, then answers 429 with Retry-After`, async () => {
      for (let i = 0; i < AUTH_LIMIT; i++) {
        await badLogin().expect(401);
      }

      const res = await badLogin().expect(429);

      expect(res.body).toEqual(TOO_MANY);
      const retryAfter = Number(res.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('applies the stricter auth limit to register and refresh too', async () => {
      for (let i = 0; i < AUTH_LIMIT; i++) {
        await http()
          .post('/auth/refresh')
          .send({ refreshToken: 'x' })
          .expect(401);
        await http().post('/auth/register').send({}).expect(400);
      }

      await http()
        .post('/auth/refresh')
        .send({ refreshToken: 'x' })
        .expect(429);
      await http().post('/auth/register').send({}).expect(429);
    });

    it('counts per endpoint: a blocked login does not block register', async () => {
      for (let i = 0; i <= AUTH_LIMIT; i++) await badLogin();
      await badLogin().expect(429);

      await http()
        .post('/auth/register')
        .send({ email: 'ali@test.com', password: 'secret123' })
        .expect(201);
    });

    it('limits other routes with the default limit only', async () => {
      // More than the auth limit, still within the default one.
      for (let i = 0; i < LIMIT; i++) {
        await http().get('/users/me').expect(401);
      }
    });

    it('counts requests without a valid token: 429 comes before 401', async () => {
      for (let i = 0; i < LIMIT; i++) {
        await http().get('/users/me').expect(401);
      }

      await http().get('/users/me').expect(429, TOO_MANY);
    });

    it('never limits /health', async () => {
      for (let i = 0; i < LIMIT * 3; i++) {
        await http().get('/health').expect(200);
      }
    });

    it('ignores X-Forwarded-For, so a spoofed IP does not reset the counter', async () => {
      for (let i = 0; i < AUTH_LIMIT; i++) {
        await badLogin(`203.0.113.${i}`).expect(401);
      }

      await badLogin('203.0.113.99').expect(429);
    });
  });

  describe('with TRUST_PROXY on (behind one reverse proxy)', () => {
    beforeEach(async () => {
      testApp = await createTestApp({ ...LOW_LIMITS, TRUST_PROXY: 'true' });
    });

    it('limits each client IP from X-Forwarded-For separately', async () => {
      for (let i = 0; i < AUTH_LIMIT; i++) {
        await badLogin('203.0.113.1').expect(401);
      }
      await badLogin('203.0.113.1').expect(429);

      // Another client behind the same proxy has its own counter.
      await badLogin('203.0.113.2').expect(401);
    });
  });
});
