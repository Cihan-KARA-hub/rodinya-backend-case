import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { Session } from '../../auth/sessions/schemas/session.schema';
import { SessionsModule } from '../../auth/sessions/sessions.module';
import { Role, User } from '../../users/schemas/user.schema';
import { UsersModule } from '../../users/users.module';
import { AdminSeedError, AdminSeeder } from './admin.seeder';

// Real (in-memory) mongod: idempotency is about what is actually stored.
describe('AdminSeeder', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let seeder: AdminSeeder;
  let userModel: Model<User>;
  let sessionModel: Model<Session>;

  const EMAIL = 'admin@test.com';
  const PASSWORD = 'secret123';

  const stored = () =>
    userModel.findOne({ email: EMAIL }).select('+passwordHash').lean();
  const openSession = (userId: string) =>
    sessionModel.create({
      userId: new Types.ObjectId(userId),
      currentJti: 'j',
      expiresAt: new Date(Date.now() + 60_000),
    });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        UsersModule,
        SessionsModule,
      ],
      providers: [AdminSeeder],
    }).compile();
    seeder = moduleRef.get(AdminSeeder);
    userModel = moduleRef.get(getModelToken(User.name));
    sessionModel = moduleRef.get(getModelToken(Session.name));
    await userModel.init(); // unique email index
  });

  afterEach(async () => {
    await userModel.deleteMany({});
    await sessionModel.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  it('creates the admin when the email is free', async () => {
    const result = await seeder.run(EMAIL, PASSWORD);

    const user = await stored();
    expect(result).toEqual({ action: 'created', userId: user!._id.toString() });
    expect(user).toMatchObject({ email: EMAIL, role: Role.Admin });
    await expect(bcrypt.compare(PASSWORD, user!.passwordHash)).resolves.toBe(
      true,
    );
  });

  it('is idempotent: a second run changes nothing', async () => {
    await seeder.run(EMAIL, PASSWORD);
    const before = await stored();

    const result = await seeder.run(EMAIL, PASSWORD);

    expect(result).toEqual({
      action: 'unchanged',
      userId: before!._id.toString(),
    });
    await expect(stored()).resolves.toEqual(before);
    await expect(userModel.countDocuments()).resolves.toBe(1);
  });

  it('matches the email case-insensitively', async () => {
    await seeder.run(EMAIL, PASSWORD);

    await expect(seeder.run('ADMIN@Test.com', PASSWORD)).resolves.toMatchObject(
      { action: 'unchanged' },
    );
  });

  it('promotes an existing user without touching their password or sessions', async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const user = await userModel.create({ email: EMAIL, passwordHash: hash });
    await openSession(user._id.toString());

    const result = await seeder.run(EMAIL, PASSWORD);

    expect(result).toEqual({
      action: 'updated',
      userId: user._id.toString(),
      promoted: true,
      passwordChanged: false,
      sessionsRevoked: 0,
    });
    await expect(stored()).resolves.toMatchObject({
      role: Role.Admin,
      passwordHash: hash,
    });
    await expect(sessionModel.countDocuments()).resolves.toBe(1);
  });

  it('resets a changed password and closes every session of that user', async () => {
    const { userId } = await seeder.run(EMAIL, PASSWORD);
    await openSession(userId);
    await openSession(userId);
    const other = await openSession(new Types.ObjectId().toString());

    const result = await seeder.run(EMAIL, 'newSecret456');

    expect(result).toEqual({
      action: 'updated',
      userId,
      promoted: false,
      passwordChanged: true,
      sessionsRevoked: 2,
    });
    const user = await stored();
    await expect(
      bcrypt.compare('newSecret456', user!.passwordHash),
    ).resolves.toBe(true);
    // Only that user's sessions are gone.
    await expect(sessionModel.find().lean()).resolves.toEqual([
      expect.objectContaining({ _id: other._id }),
    ]);
  });

  it.each([
    ['both missing', undefined, undefined],
    ['the email missing', undefined, PASSWORD],
    ['the password missing', EMAIL, undefined],
    ['an empty password', EMAIL, ''],
  ])('refuses to run with %s', async (_case, email, password) => {
    await expect(seeder.run(email, password)).rejects.toThrow(
      new AdminSeedError('ADMIN_EMAIL and ADMIN_PASSWORD must both be set'),
    );
  });

  it.each([
    ['an invalid email', 'not-an-email', PASSWORD, 'email must be an email'],
    ['a weak password (A13)', EMAIL, 'abc', 'longer than or equal to 8'],
    ['a password without a digit', EMAIL, 'abcdefgh', 'must contain a digit'],
  ])(
    'refuses %s and writes nothing',
    async (_case, email, password, reason) => {
      const run = seeder.run(email, password);

      await expect(run).rejects.toThrow(AdminSeedError);
      await expect(run).rejects.toThrow(reason);
      await expect(userModel.countDocuments()).resolves.toBe(0);
    },
  );

  it('never puts the password in an error message', async () => {
    const leaky = 'abcdefghijk'; // no digit, so it is rejected

    await expect(seeder.run(EMAIL, leaky)).rejects.not.toThrow(leaky);
  });
});
