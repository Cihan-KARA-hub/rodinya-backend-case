import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { Role, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { JwtPayload } from './auth.types';

// Real bcrypt, with `compare` wrapped so tests can count its calls.
jest.mock('bcrypt', () => {
  const actual = jest.requireActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    compare: jest.fn((data: string, hash: string) =>
      actual.compare(data, hash),
    ),
  };
});

const env: Record<string, string> = {
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;
  let users: { create: jest.Mock; findByEmailWithPassword: jest.Mock };

  const fakeUser = (passwordHash?: string) =>
    ({
      _id: new Types.ObjectId(),
      email: 'ali@test.com',
      role: Role.User,
      passwordHash,
    }) as unknown as UserDocument;

  beforeEach(async () => {
    users = { create: jest.fn(), findByEmailWithPassword: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: UsersService, useValue: users },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  const decode = (token: string, secret: string) =>
    jwt.verify<JwtPayload & { iat: number; exp: number }>(token, { secret });

  describe('register', () => {
    it('stores a bcrypt hash, never the plain password', async () => {
      users.create.mockImplementation((_email: string, hash: string) =>
        Promise.resolve(fakeUser(hash)),
      );

      await service.register('ali@test.com', 'secret123');

      const [email, hash] = users.create.mock.calls[0] as [string, string];
      expect(email).toBe('ali@test.com');
      expect(hash).not.toBe('secret123');
      expect(hash).toMatch(/^\$2b\$10\$/); // cost 10 (SPEC A13)
      await expect(bcrypt.compare('secret123', hash)).resolves.toBe(true);
    });

    it('returns the user with an access and a refresh token', async () => {
      const user = fakeUser('hash');
      users.create.mockResolvedValue(user);

      const result = await service.register('ali@test.com', 'secret123');

      expect(result.user).toBe(user);
      expect(decode(result.accessToken, 'access-secret')).toMatchObject({
        sub: user._id.toString(),
        email: 'ali@test.com',
        role: Role.User,
        type: 'access',
      });
      expect(decode(result.refreshToken, 'refresh-secret')).toMatchObject({
        sub: user._id.toString(),
        type: 'refresh',
      });
    });

    it('propagates 409 for a taken email', async () => {
      users.create.mockRejectedValue(new ConflictException());

      await expect(
        service.register('ali@test.com', 'secret123'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    let hash: string;

    beforeAll(async () => {
      hash = await bcrypt.hash('secret123', 10);
    });

    it('returns a token pair for the right password', async () => {
      users.findByEmailWithPassword.mockResolvedValue(fakeUser(hash));

      const { accessToken, refreshToken } = await service.login(
        'ali@test.com',
        'secret123',
      );

      expect(decode(accessToken, 'access-secret').type).toBe('access');
      expect(decode(refreshToken, 'refresh-secret').type).toBe('refresh');
    });

    it('signs each token with its own secret and lifetime', async () => {
      users.findByEmailWithPassword.mockResolvedValue(fakeUser(hash));

      const { accessToken, refreshToken } = await service.login(
        'ali@test.com',
        'secret123',
      );

      expect(() => decode(accessToken, 'refresh-secret')).toThrow();
      expect(() => decode(refreshToken, 'access-secret')).toThrow();
      const access = decode(accessToken, 'access-secret');
      const refresh = decode(refreshToken, 'refresh-secret');
      expect(access.exp - access.iat).toBe(15 * 60);
      expect(refresh.exp - refresh.iat).toBe(7 * 24 * 60 * 60);
    });

    it('rejects a wrong password with 401', async () => {
      users.findByEmailWithPassword.mockResolvedValue(fakeUser(hash));

      await expect(service.login('ali@test.com', 'wrong123')).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects an unknown email with the same 401, after a bcrypt compare', async () => {
      users.findByEmailWithPassword.mockResolvedValue(null);
      jest.mocked(bcrypt.compare).mockClear();

      await expect(
        service.login('nobody@test.com', 'secret123'),
      ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });
  });
});
