import { ExecutionContext, HttpException } from '@nestjs/common';
import { ThrottlerLimitDetail } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

// The counting itself is the library's and is covered end to end in
// test/throttle.e2e-spec.ts; this pins down what the override adds.
describe('AppThrottlerGuard', () => {
  // Built without DI: only the overridden method is under test.
  const guard = Object.create(AppThrottlerGuard.prototype) as {
    throwThrottlingException(
      context: ExecutionContext,
      detail: ThrottlerLimitDetail,
    ): Promise<void>;
  };

  /** Calls the override and returns what it threw. */
  const trigger = () => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({ getResponse: () => ({ setHeader }) }),
    } as unknown as ExecutionContext;
    let thrown: unknown;
    try {
      void guard.throwThrottlingException(context, {
        timeToBlockExpire: 42,
      } as ThrottlerLimitDetail);
    } catch (err) {
      thrown = err;
    }
    return { setHeader, thrown };
  };

  it('sets a standard Retry-After header', () => {
    const { setHeader } = trigger();

    expect(setHeader).toHaveBeenCalledWith('Retry-After', 42);
  });

  it('throws 429 with the same body shape as every other error', () => {
    const { thrown } = trigger();

    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(429);
    expect((thrown as HttpException).getResponse()).toEqual({
      statusCode: 429,
      message: 'Too many requests, please try again later',
      error: 'Too Many Requests',
    });
  });
});
