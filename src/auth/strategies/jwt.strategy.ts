import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { isValidObjectId } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvVars } from '../../config/env.validation';
import { UsersService } from '../../users/users.service';
import { AuthUser, JwtPayload } from '../auth.types';

/**
 * Verifies the Bearer access token (signature and expiry), then loads the user
 * from the database on every request, so a deleted user or a changed role takes
 * effect immediately instead of when the token expires.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // A refresh token must not work as a Bearer token (SPEC A1).
    if (payload.type !== 'access' || !isValidObjectId(payload.sub)) {
      throw new UnauthorizedException();
    }
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return { id: user._id.toString(), email: user.email, role: user.role };
  }
}
