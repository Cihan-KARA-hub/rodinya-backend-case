import { model } from 'mongoose';
import { Role, User, UserSchema } from './user.schema';

describe('UserSchema', () => {
  const UserModel = model(User.name, UserSchema);

  it('normalizes email to trimmed lowercase', () => {
    const user = new UserModel({
      email: '  Foo@Example.COM ',
      passwordHash: 'h',
    });

    expect(user.email).toBe('foo@example.com');
  });

  it('defaults role to user and rejects unknown roles', () => {
    const user = new UserModel({ email: 'a@b.co', passwordHash: 'h' });
    expect(user.role).toBe(Role.User);

    user.set('role', 'root');
    expect(user.validateSync()?.errors).toHaveProperty('role');
  });

  it('requires email and passwordHash', () => {
    const errors = new UserModel({}).validateSync()?.errors;

    expect(errors).toHaveProperty('email');
    expect(errors).toHaveProperty('passwordHash');
  });

  it('declares a unique index on email', () => {
    expect(UserSchema.indexes()).toContainEqual([
      { email: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  it('keeps passwordHash out of queries and JSON', () => {
    expect(UserSchema.path('passwordHash').options).toMatchObject({
      select: false,
    });

    const json = new UserModel({
      email: 'a@b.co',
      passwordHash: 'h',
    }).toJSON();
    expect(json).not.toHaveProperty('passwordHash');
    expect(json).toHaveProperty('id');
  });
});
