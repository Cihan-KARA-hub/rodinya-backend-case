import { SetMetadata } from '@nestjs/common';

export const AUTH_THROTTLE_KEY = 'authThrottle';

/**
 * Puts a route under the stricter `auth` rate limit (THROTTLE_AUTH_LIMIT,
 * SPEC A16) on top of the global one. For credential endpoints, where
 * repeated attempts mean guessing passwords or tokens.
 */
export const AuthThrottle = () => SetMetadata(AUTH_THROTTLE_KEY, true);
