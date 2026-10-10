import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    MediaModule,
    HealthModule,
  ],
})
export class AppModule {}
