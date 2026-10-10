import { Role } from '../users/schemas/user.schema';

/** Access and refresh tokens carry `type` so one can't stand in for the other (SPEC A1). */
export type TokenType = 'access' | 'refresh';

/** Both tokens name the session (`sid`) they belong to. */
export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  role: Role;
  type: 'access';
}

/** `jti` identifies this one refresh token; the session accepts only its current jti. */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  type: 'refresh';
}

export type JwtPayload = AccessTokenPayload | RefreshTokenPayload;

/** What JwtStrategy puts on `request.user`; read with @CurrentUser(). */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  /** The session of the access token in use; logout closes it. */
  sessionId: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
