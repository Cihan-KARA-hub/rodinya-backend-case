import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { Role, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types';
import { SessionsService } from './sessions/sessions.service';

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
  let users: {
    create: jest.Mock;
    findByEmailWithPassword: jest.Mock;
    findById: jest.Mock;
  };
  let sessions: { create: jest.Mock; rotate: jest.Mock; revoke: jest.Mock };

  const fakeUser = (passwordHash?: string) =>
    ({
      _id: new Types.ObjectId(),
      email: 'ali@test.com',
      role: Role.User,
      passwordHash,
    }) as unknown as UserDocument;

  beforeEach(async () => {
    users = {
      create: jest.fn(),
      findByEmailWithPassword: jest.fn(),
      findById: jest.fn(),
    };
    sessions = {
      create: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue(true),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: UsersService, useValue: users },
        { provide: SessionsService, useValue: sessions },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  type Claims = { iat: number; exp: number };
  const decodeAccess = (token: string, secret = 'access-secret') =>
    jwt.verify<AccessTokenPayload & Claims>(token, { secret });
  const decodeRefresh = (token: string, secret = 'refresh-secret') =>
    jwt.verify<RefreshTokenPayload & Claims>(token, { secret });

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
      const access = decodeAccess(result.accessToken);
      const refresh = decodeRefresh(result.refreshToken);
      expect(access).toMatchObject({
        sub: user._id.toString(),
        email: 'ali@test.com',
        role: Role.User,
        type: 'access',
      });
      expect(refresh).toMatchObject({
        sub: user._id.toString(),
        type: 'refresh',
      });
      // Both tokens belong to the same new session.
      expect(access.sid).toBe(refresh.sid);
      expect(typeof refresh.jti).toBe('string');
    });

    it('opens a session that expires with the refresh token', async () => {
      const user = fakeUser('hash');
      users.create.mockResolvedValue(user);

      const { refreshToken } = await service.register(
        'ali@test.com',
        'secret123',
      );

      const refresh = decodeRefresh(refreshToken);
      const [sessionId, userId, jti, expiresAt] = sessions.create.mock
        .calls[0] as [Types.ObjectId, string, string, Date];
      expect(sessionId.toString()).toBe(refresh.sid);
      expect(userId).toBe(user._id.toString());
      expect(jti).toBe(refresh.jti);
      expect(expiresAt.getTime()).toBe(refresh.exp * 1000);
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

      expect(decodeAccess(accessToken).type).toBe('access');
      expect(decodeRefresh(refreshToken).type).toBe('refresh');
    });

    it('opens a separate session for every login (one per device)', async () => {
      users.findByEmailWithPassword.mockResolvedValue(fakeUser(hash));

      const phone = await service.login('ali@test.com', 'secret123');
      const laptop = await service.login('ali@test.com', 'secret123');

      expect(sessions.create).toHaveBeenCalledTimes(2);
      expect(decodeAccess(phone.accessToken).sid).not.toBe(
        decodeAccess(laptop.accessToken).sid,
      );
    });

    it('signs each token with its own secret and lifetime', async () => {
      users.findByEmailWithPassword.mockResolvedValue(fakeUser(hash));

      const { accessToken, refreshToken } = await service.login(
        'ali@test.com',
        'secret123',
      );

      expect(() => decodeAccess(accessToken, 'refresh-secret')).toThrow();
      expect(() => decodeRefresh(refreshToken, 'access-secret')).toThrow();
      const access = decodeAccess(accessToken);
      const refresh = decodeRefresh(refreshToken);
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
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes only the given session', async () => {
      const sid = new Types.ObjectId().toString();

      await service.logout(sid);

      expect(sessions.revoke).toHaveBeenCalledTimes(1);
      expect(sessions.revoke).toHaveBeenCalledWith(sid);
    });
  });

  describe('refresh', () => {
    const invalid = new UnauthorizedException(
      'Invalid or expired refresh token',
    );
    let user: UserDocument;
    let tokens: { accessToken: string; refreshToken: string };

    beforeEach(async () => {
      user = fakeUser(await bcrypt.hash('secret123', 4));
      users.findByEmailWithPassword.mockResolvedValue(user);
      users.findById.mockResolvedValue(user);
      tokens = await service.login('ali@test.com', 'secret123');
    });

    it('rotates to a new pair within the same session', async () => {
      const old = decodeRefresh(tokens.refreshToken);

      const next = await service.refresh(tokens.refreshToken);

      const access = decodeAccess(next.accessToken);
      const refresh = decodeRefresh(next.refreshToken);
      expect(access).toMatchObject({ sub: old.sub, sid: old.sid });
      expect(refresh).toMatchObject({ sub: old.sub, sid: old.sid });
      expect(refresh.jti).not.toBe(old.jti);
      expect(sessions.rotate).toHaveBeenCalledWith(
        old.sid,
        old.sub,
        old.jti,
        refresh.jti,
        new Date(refresh.exp * 1000),
      );
    });

    it('rejects a reused refresh token (rotate refuses it)', async () => {
      sessions.rotate.mockResolvedValue(false);

      await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(
        invalid,
      );
    });

    it('rejects an access token', async () => {
      await expect(service.refresh(tokens.accessToken)).rejects.toThrow(
        invalid,
      );
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects a token signed with the refresh secret but typed access', async () => {
      const forged = jwt.sign(
        { ...decodeRefresh(tokens.refreshToken), type: 'access' },
        { secret: 'refresh-secret' },
      );

      await expect(service.refresh(forged)).rejects.toThrow(invalid);
      expect(sessions.rotate).not.toHaveBeenCalled();
    });

    it('rejects an expired refresh token', async () => {
      const { sub, sid, jti } = decodeRefresh(tokens.refreshToken);
      const expired = jwt.sign(
        {
          sub,
          sid,
          jti,
          type: 'refresh',
          exp: Math.floor(Date.now() / 1000) - 10,
        },
        { secret: 'refresh-secret' },
      );

      await expect(service.refresh(expired)).rejects.toThrow(invalid);
    });

    it('rejects a malformed token', async () => {
      await expect(service.refresh('not-a-jwt')).rejects.toThrow(invalid);
    });

    it('rejects and closes the session when the user no longer exists', async () => {
      users.findById.mockResolvedValue(null);
      const { sid } = decodeRefresh(tokens.refreshToken);

      await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(
        invalid,
      );
      expect(sessions.revoke).toHaveBeenCalledWith(sid);
      expect(sessions.rotate).not.toHaveBeenCalled();
    });
  });
});
