import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Application } from 'express';
import { EnvVars } from './config/env.validation';
import { setupSwagger } from './swagger';

/** App-wide setup shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  // Behind one reverse proxy, take the client IP from X-Forwarded-For so rate
  // limits apply per real client. Off by default: without a proxy, a client
  // could set that header itself and dodge the limits (SPEC A16).
  if (
    app.get(ConfigService<EnvVars, true>).get('TRUST_PROXY', { infer: true })
  ) {
    const server = app.getHttpAdapter().getInstance() as Application;
    server.set('trust proxy', 1);
  }

  setupSwagger(app);
}
