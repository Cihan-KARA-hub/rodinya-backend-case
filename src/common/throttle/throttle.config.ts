import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions } from '@nestjs/throttler';
import { EnvVars } from '../../config/env.validation';
import { AUTH_THROTTLE_KEY } from '../decorators/auth-throttle.decorator';

/**
 * Two counters per client IP (SPEC A16), both over THROTTLE_TTL ms:
 * - `default`: every route, THROTTLE_LIMIT requests;
 * - `auth`: only routes marked @AuthThrottle(), THROTTLE_AUTH_LIMIT requests.
 * A marked route counts against both, so the stricter one trips first.
 * Counters live in memory, i.e. per process.
 */
export function throttleConfig(
  config: ConfigService<EnvVars, true>,
  reflector: Reflector,
): ThrottlerModuleOptions {
  const ttl = config.get('THROTTLE_TTL', { infer: true });
  return {
    throttlers: [
      {
        name: 'default',
        ttl,
        limit: config.get('THROTTLE_LIMIT', { infer: true }),
      },
      {
        name: 'auth',
        ttl,
        limit: config.get('THROTTLE_AUTH_LIMIT', { infer: true }),
        skipIf: (context) =>
          !reflector.getAllAndOverride<boolean>(AUTH_THROTTLE_KEY, [
            context.getHandler(),
            context.getClass(),
          ]),
      },
    ],
  };
}
