import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { EnvVars } from '../config/env.validation';
import { UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { JwtPayload, TokenPair, TokenType } from './auth.types';

const BCRYPT_COST = 10; // SPEC A13

/**
 * Compared against when the email is unknown, so a missing user costs the same
 * bcrypt time as a wrong password and response timing doesn't reveal which
 * emails are registered.
 */
const TIMING_DUMMY_HASH =
  '$2b$10$3nN5E0xec2clF0JVVXkaB.q5A5o/M30./Y0CxS1JArdVMQwN.uUiu';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  async register(
    email: string,
    password: string,
  ): Promise<{ user: UserDocument } & TokenPair> {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await this.usersService.create(email, passwordHash);
    return { user, ...(await this.issueTokens(user)) };
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
    return this.issueTokens(user);
  }

  private async issueTokens(user: UserDocument): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.sign(user, 'access'),
      this.sign(user, 'refresh'),
    ]);
    return { accessToken, refreshToken };
  }

  private sign(user: UserDocument, type: TokenType): Promise<string> {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      type,
    };
    const [secret, expiresIn] =
      type === 'access'
        ? [
            this.config.get('JWT_ACCESS_SECRET', { infer: true }),
            this.config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
          ]
        : [
            this.config.get('JWT_REFRESH_SECRET', { infer: true }),
            this.config.get('JWT_REFRESH_EXPIRES_IN', { infer: true }),
          ];
    return this.jwtService.signAsync(payload, {
      secret,
      // Typed as an `ms` duration ('15m', '7d'); the env holds a plain string.
      expiresIn: expiresIn as JwtSignOptions['expiresIn'],
    });
  }
}
