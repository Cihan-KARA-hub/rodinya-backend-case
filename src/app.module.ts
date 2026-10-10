import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppThrottlerGuard } from './common/throttle/app-throttler.guard';
import { throttleConfig } from './common/throttle/throttle.config';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, Reflector],
      useFactory: throttleConfig,
    }),
    DatabaseModule,
    AuthModule,
    MediaModule,
    HealthModule,
  ],
  // Global guards run in this order. Rate limiting comes first, so requests
  // with missing or bad tokens are counted too (429 before 401).
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
