import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { Session, SessionSchema } from './schemas/session.schema';
import { SessionsModule } from './sessions.module';
import { SessionsService } from './sessions.service';

// Against a real (in-memory) mongod: the atomic compare-and-swap in rotate()
// and the TTL index are database behaviour.
describe('SessionsService', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: SessionsService;
  let sessionModel: Model<Session>;

  const userId = new Types.ObjectId().toString();
  const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const newSession = async (jti = 'jti-1', expiresAt = inAWeek()) => {
    const sessionId = new Types.ObjectId();
    await service.create(sessionId, userId, jti, expiresAt);
    return sessionId.toString();
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), SessionsModule],
    }).compile();
    service = moduleRef.get(SessionsService);
    sessionModel = moduleRef.get(getModelToken(Session.name));
  });

  afterEach(async () => {
    await sessionModel.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('declares a TTL index on expiresAt and an ObjectId userId', () => {
    expect(SessionSchema.indexes()).toContainEqual([
      { expiresAt: 1 },
      expect.objectContaining({ expireAfterSeconds: 0 }),
    ]);
    expect(SessionSchema.path('userId').instance).toBe('ObjectId');
  });

  describe('isActive', () => {
    it('is true for a live session of that user', async () => {
      const sid = await newSession();

      await expect(service.isActive(sid, userId)).resolves.toBe(true);
    });

    it('is false for another user, an expired or an unknown session', async () => {
      const sid = await newSession();
      const expired = await newSession('jti-x', new Date(Date.now() - 1000));
      const otherUser = new Types.ObjectId().toString();

      await expect(service.isActive(sid, otherUser)).resolves.toBe(false);
      await expect(service.isActive(expired, userId)).resolves.toBe(false);
      await expect(
        service.isActive(new Types.ObjectId().toString(), userId),
      ).resolves.toBe(false);
    });
  });

  describe('rotate', () => {
    it('swaps to the next jti and extends the expiry', async () => {
      const sid = await newSession('jti-1', new Date(Date.now() + 60_000));
      const later = inAWeek();

      await expect(
        service.rotate(sid, userId, 'jti-1', 'jti-2', later),
      ).resolves.toBe(true);

      const session = await sessionModel.findById(sid).lean();
      expect(session).toMatchObject({ currentJti: 'jti-2', expiresAt: later });
    });

    it('treats an already-used jti as theft and deletes the session', async () => {
      const sid = await newSession('jti-1');
      await service.rotate(sid, userId, 'jti-1', 'jti-2', inAWeek());

      // jti-1 comes back after it was exchanged.
      await expect(
        service.rotate(sid, userId, 'jti-1', 'jti-3', inAWeek()),
      ).resolves.toBe(false);

      await expect(sessionModel.findById(sid)).resolves.toBeNull();
      // The legitimate holder of jti-2 is logged out too.
      await expect(
        service.rotate(sid, userId, 'jti-2', 'jti-4', inAWeek()),
      ).resolves.toBe(false);
    });

    it('redeems a refresh token only once under concurrent requests', async () => {
      const sid = await newSession('jti-1');

      const results = await Promise.all([
        service.rotate(sid, userId, 'jti-1', 'jti-a', inAWeek()),
        service.rotate(sid, userId, 'jti-1', 'jti-b', inAWeek()),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('rejects an expired session', async () => {
      const sid = await newSession('jti-1', new Date(Date.now() - 1000));

      await expect(
        service.rotate(sid, userId, 'jti-1', 'jti-2', inAWeek()),
      ).resolves.toBe(false);
    });

    it("does not touch another user's session", async () => {
      const sid = await newSession('jti-1');
      const otherUser = new Types.ObjectId().toString();

      await expect(
        service.rotate(sid, otherUser, 'jti-1', 'jti-2', inAWeek()),
      ).resolves.toBe(false);
      await expect(service.isActive(sid, userId)).resolves.toBe(true);
    });
  });

  describe('revoke', () => {
    it('deletes only that session', async () => {
      const phone = await newSession('jti-phone');
      const laptop = await newSession('jti-laptop');

      await service.revoke(phone);

      await expect(service.isActive(phone, userId)).resolves.toBe(false);
      await expect(service.isActive(laptop, userId)).resolves.toBe(true);
    });
  });
});
