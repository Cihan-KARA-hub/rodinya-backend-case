import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

async function failedFields<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('RegisterDto', () => {
  const valid = { email: 'ali@test.com', password: 'secret123' };

  it('accepts a valid body', async () => {
    await expect(failedFields(RegisterDto, valid)).resolves.toEqual([]);
  });

  it('rejects an invalid email', async () => {
    await expect(
      failedFields(RegisterDto, { ...valid, email: 'not-an-email' }),
    ).resolves.toEqual(['email']);
  });

  it.each([
    ['shorter than 8 characters', 'abc1234'],
    ['without a digit', 'abcdefgh'],
    ['without a letter', '12345678'],
    ['longer than 72 bytes', 'a1'.repeat(37)],
    ['over 72 bytes in multi-byte characters', 'ğ1'.repeat(25)], // 50 chars, 75 bytes
    ['not a string', 12345678],
  ])('rejects a password %s', async (_case, password) => {
    await expect(
      failedFields(RegisterDto, { ...valid, password }),
    ).resolves.toEqual(['password']);
  });

  it('accepts a password of exactly 72 bytes and non-latin letters', async () => {
    await expect(
      failedFields(RegisterDto, { ...valid, password: 'a1'.repeat(36) }),
    ).resolves.toEqual([]);
    await expect(
      failedFields(RegisterDto, { ...valid, password: 'şifre1234' }),
    ).resolves.toEqual([]);
  });
});

describe('LoginDto', () => {
  it('does not apply the strength rule', async () => {
    await expect(
      failedFields(LoginDto, { email: 'ali@test.com', password: 'x' }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['longer than 72 bytes', 'a'.repeat(73)],
  ])('rejects a password that is %s', async (_case, password) => {
    await expect(
      failedFields(LoginDto, { email: 'ali@test.com', password }),
    ).resolves.toEqual(['password']);
  });
});
