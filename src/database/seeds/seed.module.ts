import { Module } from '@nestjs/common';
import { SessionsModule } from '../../auth/sessions/sessions.module';
import { AppConfigModule } from '../../config/app-config.module';
import { UsersModule } from '../../users/users.module';
import { DatabaseModule } from '../database.module';
import { AdminSeeder } from './admin.seeder';

/** Only what seeding needs: no HTTP, no media, no upload directory. */
@Module({
  imports: [AppConfigModule, DatabaseModule, UsersModule, SessionsModule],
  providers: [AdminSeeder],
})
export class SeedModule {}
