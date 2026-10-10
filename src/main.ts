import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { EnvVars } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = app.get(ConfigService<EnvVars, true>).get('PORT', {
    infer: true,
  });
  await app.listen(port, '0.0.0.0');
  Logger.log(`Listening on port ${port} (docs at /docs)`, 'Bootstrap');
}
void bootstrap();
