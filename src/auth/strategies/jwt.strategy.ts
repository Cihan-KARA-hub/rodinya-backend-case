import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { isValidObjectId } from 'mongoose';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvVars } from '../../config/env.validation';
import { UsersService } from '../../users/users.service';
import { AuthUser, JwtPayload } from '../auth.types';
import { SessionsService } from '../sessions/sessions.service';

/**
 * Verifies the Bearer access token (signature and expiry), then checks the
 * database on every request: the user must still exist and the token's session
 * must still be open. A deleted user, a changed role, a logout or a detected
 * refresh-token theft therefore takes effect immediately, not when the access
 * token expires (SPEC A1).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvVars, true>,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // A refresh token must not work as a Bearer token (SPEC A1).
    if (
      payload.type !== 'access' ||
      !isValidObjectId(payload.sub) ||
      !isValidObjectId(payload.sid)
    ) {
      throw new UnauthorizedException();
    }
    const [user, sessionOpen] = await Promise.all([
      this.usersService.findById(payload.sub),
      this.sessionsService.isActive(payload.sid, payload.sub),
    ]);
    if (!user || !sessionOpen) {
      throw new UnauthorizedException();
    }
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      sessionId: payload.sid,
    };
  }
}
