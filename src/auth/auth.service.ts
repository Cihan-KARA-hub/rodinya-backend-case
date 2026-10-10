import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Types, isValidObjectId } from 'mongoose';
import { EnvVars } from '../config/env.validation';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  AccessTokenPayload,
  JwtPayload,
  RefreshTokenPayload,
  TokenPair,
} from './auth.types';
import { hashPassword } from './password';
import { SessionsService } from './sessions/sessions.service';

/**
 * Compared against when the email is unknown, so a missing user costs the same
 * bcrypt time as a wrong password and response timing doesn't reveal which
 * emails are registered.
 */
const TIMING_DUMMY_HASH =
  '$2b$10$3nN5E0xec2clF0JVVXkaB.q5A5o/M30./Y0CxS1JArdVMQwN.uUiu';

const INVALID_REFRESH = 'Invalid or expired refresh token';

/** A signed pair plus what the session needs to remember about it. */
interface IssuedTokens extends TokenPair {
  jti: string;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async register(
    email: string,
    password: string,
  ): Promise<{ user: UserDocument } & TokenPair> {
    const passwordHash = await hashPassword(password);
    const user = await this.usersService.create(email, passwordHash);
    return { user, ...(await this.startSession(user)) };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.usersService.findByEmailWithPassword(email);
    const matches = await bcrypt.compare(
      password,
      user?.passwordHash ?? TIMING_DUMMY_HASH,
    );
    if (!user || !matches) {
      // Same message for both cases (SPEC A8).
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.startSession(user);
  }

  /**
   * Exchanges a refresh token for a new pair in the same session. The old
   * refresh token stops working (rotation); presenting it again revokes the
   * session (SPEC A1). Every failure is the same 401.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      await this.sessionsService.revoke(payload.sid);
      throw new UnauthorizedException(INVALID_REFRESH);
    }

    const { jti, refreshExpiresAt, ...tokens } = await this.issueTokens(
      user,
      payload.sid,
    );
    const rotated = await this.sessionsService.rotate(
      payload.sid,
      payload.sub,
      payload.jti,
      jti,
      refreshExpiresAt,
    );
    if (!rotated) throw new UnauthorizedException(INVALID_REFRESH);
    return tokens;
  }

  /** Closes one session (one device); its refresh and access tokens stop working. */
  logout(sessionId: string): Promise<void> {
    return this.sessionsService.revoke(sessionId);
  }

  private async startSession(user: UserDocument): Promise<TokenPair> {
    const sessionId = new Types.ObjectId();
    const { jti, refreshExpiresAt, ...tokens } = await this.issueTokens(
      user,
      sessionId.toString(),
    );
    await this.sessionsService.create(
      sessionId,
      user._id.toString(),
      jti,
      refreshExpiresAt,
    );
    return tokens;
  }

  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    let payload: JwtPayload;
    try {
      // Checks signature (refresh secret, so an access token fails here) and expiry.
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    if (
      payload.type !== 'refresh' ||
      !isValidObjectId(payload.sub) ||
      !isValidObjectId(payload.sid) ||
      typeof payload.jti !== 'string'
    ) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    return payload;
  }

  private async issueTokens(
    user: UserDocument,
    sessionId: string,
  ): Promise<IssuedTokens> {
    const sub = user._id.toString();
    const jti = randomUUID();
    const access: AccessTokenPayload = {
      sub,
      sid: sessionId,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const refresh: RefreshTokenPayload = {
      sub,
      sid: sessionId,
      jti,
      type: 'refresh',
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.sign(access, 'JWT_ACCESS_SECRET', 'JWT_ACCESS_EXPIRES_IN'),
      this.sign(refresh, 'JWT_REFRESH_SECRET', 'JWT_REFRESH_EXPIRES_IN'),
    ]);
    // The session lives exactly as long as its refresh token.
    const { exp } = this.jwtService.decode<{ exp: number }>(refreshToken);
    return {
      accessToken,
      refreshToken,
      jti,
      refreshExpiresAt: new Date(exp * 1000),
    };
  }

  private sign(
    payload: JwtPayload,
    secretKey: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
    expiresInKey: 'JWT_ACCESS_EXPIRES_IN' | 'JWT_REFRESH_EXPIRES_IN',
  ): Promise<string> {
    const expiresIn: string = this.config.get(expiresInKey, { infer: true });
    return this.jwtService.signAsync(payload, {
      secret: this.config.get(secretKey, { infer: true }),
      // Typed as an `ms` duration ('15m', '7d'); the env holds a plain string.
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
  }
}
