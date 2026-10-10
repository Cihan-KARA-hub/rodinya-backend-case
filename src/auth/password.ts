import * as bcrypt from 'bcrypt';

export const BCRYPT_COST = 10; // SPEC A13

/** The one place passwords are hashed: registration and the admin seed. */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}
