/**
 * Creates or updates the admin account from ADMIN_EMAIL / ADMIN_PASSWORD
 * (SPEC A3). Idempotent.
 *
 *   npm run seed:admin       compiled (dist/), e.g. inside the Docker image
 *   npm run seed:admin:dev   straight from TypeScript, no build needed
 *
 * Exits with code 1 on any problem. The password is never logged.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AdminSeedError, AdminSeedResult, AdminSeeder } from './admin.seeder';
import { SeedModule } from './seed.module';

const logger = new Logger('SeedAdmin');

function summary(result: AdminSeedResult, email: string): string {
  switch (result.action) {
    case 'created':
      return `Admin ${email} created (id ${result.userId})`;
    case 'unchanged':
      return `Admin ${email} is already up to date (id ${result.userId})`;
    case 'updated': {
      const changes = [
        result.promoted && 'promoted to admin',
        result.passwordChanged &&
          `password reset, ${result.sessionsRevoked} session(s) closed`,
      ].filter(Boolean);
      return `Admin ${email} updated: ${changes.join(', ')} (id ${result.userId})`;
    }
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const config = app.get(ConfigService);
    const email = config.get<string>('ADMIN_EMAIL');
    const password = config.get<string>('ADMIN_PASSWORD');

    const result = await app.get(AdminSeeder).run(email, password);
    logger.log(summary(result, email!));
  } catch (err) {
    // Expected misconfiguration: one clear line. Anything else: full error.
    if (err instanceof AdminSeedError) logger.error(err.message);
    else logger.error(err instanceof Error ? err.stack : String(err));
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
