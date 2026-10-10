import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from '../../auth/dto/register.dto';
import { hashPassword } from '../../auth/password';
import { SessionsService } from '../../auth/sessions/sessions.service';
import { Role } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';

export type AdminSeedResult =
  | { action: 'created'; userId: string }
  | {
      action: 'updated';
      userId: string;
      promoted: boolean;
      passwordChanged: boolean;
      sessionsRevoked: number;
    }
  | { action: 'unchanged'; userId: string };

/** A configuration problem the operator must fix (bad or missing env). */
export class AdminSeedError extends Error {}

/**
 * Makes the account at `email` an admin with `password` (SPEC A3). Idempotent:
 * the env is the source of truth, and running it again changes nothing.
 * The admin role grants no rights over media; it only exists as a role.
 */
@Injectable()
export class AdminSeeder {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
  ) {}

  async run(email?: string, password?: string): Promise<AdminSeedResult> {
    if (!email || !password) {
      throw new AdminSeedError(
        'ADMIN_EMAIL and ADMIN_PASSWORD must both be set',
      );
    }
    await this.assertValid(email, password);

    const existing = await this.usersService.findByEmailWithPassword(email);
    if (!existing) {
      const user = await this.usersService.create(
        email,
        await hashPassword(password),
        Role.Admin,
      );
      return { action: 'created', userId: user._id.toString() };
    }

    const userId = existing._id.toString();
    const promoted = existing.role !== Role.Admin;
    const passwordChanged = !(await bcrypt.compare(
      password,
      existing.passwordHash,
    ));
    if (!promoted && !passwordChanged) {
      return { action: 'unchanged', userId };
    }

    await this.usersService.update(userId, {
      role: Role.Admin,
      ...(passwordChanged && { passwordHash: await hashPassword(password) }),
    });
    // Sessions opened with the old password must not outlive the reset.
    const sessionsRevoked = passwordChanged
      ? await this.sessionsService.revokeAllForUser(userId)
      : 0;
    return {
      action: 'updated',
      userId,
      promoted,
      passwordChanged,
      sessionsRevoked,
    };
  }

  /** Same rules as registration (SPEC A13), so an admin can't have a weak password. */
  private async assertValid(email: string, password: string): Promise<void> {
    const errors = await validate(
      plainToInstance(RegisterDto, { email, password }),
    );
    if (errors.length > 0) {
      const reasons = errors
        .flatMap((e) => Object.values(e.constraints ?? {}))
        // Never echo the password itself; the constraint texts don't contain it.
        .join('; ');
      throw new AdminSeedError(
        `Invalid ADMIN_EMAIL / ADMIN_PASSWORD: ${reasons}`,
      );
    }
  }
}
