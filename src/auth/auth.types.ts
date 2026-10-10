import { Role } from '../users/schemas/user.schema';

/** Access and refresh tokens carry `type` so one can't stand in for the other (SPEC A1). */
export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  type: TokenType;
}

/** What JwtStrategy puts on `request.user`; read with @CurrentUser(). */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
