import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import type { AuthUser, JwtPayload } from '../auth.types';
import { SessionsService } from '../sessions/sessions.service';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller()
class TestController {
  @Get('private')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }
}

const ACCESS_SECRET = 'access-secret';

// Guard, strategy and @CurrentUser() wired together as in the app, with only
// UsersService and SessionsService faked.
describe('JwtAuthGuard + JwtStrategy', () => {
  let app: INestApplication<App>;
  const jwt = new JwtService();
  const userId = new Types.ObjectId().toString();
  const sessionId = new Types.ObjectId().toString();
  const findById = jest.fn();
  const isActive = jest.fn();

  const token = (overrides: Partial<JwtPayload> = {}, secret = ACCESS_SECRET) =>
    jwt.sign(
      {
        sub: userId,
        sid: sessionId,
        email: 'ali@test.com',
        role: Role.User,
        type: 'access',
        ...overrides,
      },
      { secret, expiresIn: '15m' },
    );

  const get = (path: string, bearer?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return bearer ? req.set('Authorization', `Bearer ${bearer}`) : req;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [TestController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: UsersService, useValue: { findById } },
        { provide: SessionsService, useValue: { isActive } },
        { provide: ConfigService, useValue: { get: () => ACCESS_SECRET } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    findById.mockReset();
    findById.mockResolvedValue({
      _id: new Types.ObjectId(userId),
      email: 'ali@test.com',
      role: Role.Admin, // differs from the token: the DB value must win
    });
    isActive.mockReset();
    isActive.mockResolvedValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets @Public() routes through without a token', async () => {
    await get('/open').expect(200, { ok: true });
  });

  it('rejects a protected route without a token', async () => {
    await get('/private').expect(401);
  });

  it('exposes the user loaded from the database via @CurrentUser()', async () => {
    await get('/private', token()).expect(200, {
      id: userId,
      email: 'ali@test.com',
      role: Role.Admin,
      sessionId,
    });
    expect(findById).toHaveBeenCalledWith(userId);
    expect(isActive).toHaveBeenCalledWith(sessionId, userId);
  });

  it('rejects a token whose session was closed (logout or theft)', async () => {
    isActive.mockResolvedValue(false);

    await get('/private', token()).expect(401);
  });

  it('rejects a token without a valid session id', async () => {
    await get('/private', token({ sid: undefined })).expect(401);
    await get('/private', token({ sid: 'not-an-id' })).expect(401);
    expect(isActive).not.toHaveBeenCalled();
  });

  it('rejects a token whose user no longer exists', async () => {
    findById.mockResolvedValue(null);

    await get('/private', token()).expect(401);
  });

  it('rejects a refresh token used as a Bearer token', async () => {
    await get('/private', token({ type: 'refresh' })).expect(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it('rejects a token signed with another secret', async () => {
    await get('/private', token({}, 'refresh-secret')).expect(401);
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign(
      { sub: userId, type: 'access', exp: Math.floor(Date.now() / 1000) - 10 },
      { secret: ACCESS_SECRET },
    );

    await get('/private', expired).expect(401);
  });

  it('rejects a token whose subject is not an ObjectId', async () => {
    await get('/private', token({ sub: 'not-an-id' })).expect(401);
    expect(findById).not.toHaveBeenCalled();
  });
});
