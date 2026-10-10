import { ConflictException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { Role, User } from './schemas/user.schema';
import { UsersModule } from './users.module';
import { UsersService } from './users.service';

// Runs against a real (in-memory) mongod: the unique index and `select: false`
// are database behaviour that a mocked model cannot prove.
describe('UsersService', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: UsersService;
  let userModel: Model<User>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), UsersModule],
    }).compile();
    service = moduleRef.get(UsersService);
    userModel = moduleRef.get(getModelToken(User.name));
    await userModel.init(); // wait for the unique index
  });

  afterEach(async () => {
    await userModel.deleteMany({});
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongo.stop();
  });

  describe('create', () => {
    it('stores a user with the default role and without exposing the hash', async () => {
      const user = await service.create('Ali@Test.com', 'hash');

      expect(user.toJSON()).toMatchObject({
        id: user._id.toString(),
        email: 'ali@test.com',
        role: Role.User,
      });
      expect(user.toJSON()).not.toHaveProperty('passwordHash');
    });

    it('throws 409 when the email is taken, regardless of case', async () => {
      await service.create('ali@test.com', 'hash');

      await expect(service.create('ALI@test.com', 'hash')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findByEmailWithPassword', () => {
    it('loads the hash and matches the email case-insensitively', async () => {
      await service.create('ali@test.com', 'hash');

      const user = await service.findByEmailWithPassword(' Ali@Test.COM ');

      expect(user?.passwordHash).toBe('hash');
    });

    it('returns null for an unknown email', async () => {
      await expect(
        service.findByEmailWithPassword('nobody@test.com'),
      ).resolves.toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the user without the hash', async () => {
      const created = await service.create('ali@test.com', 'hash');

      const user = await service.findById(created._id.toString());

      expect(user?.email).toBe('ali@test.com');
      expect(user?.passwordHash).toBeUndefined();
    });

    it('returns null for an unknown id', async () => {
      await expect(
        service.findById(new Types.ObjectId().toString()),
      ).resolves.toBeNull();
    });
  });
});
