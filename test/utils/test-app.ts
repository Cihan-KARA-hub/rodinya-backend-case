import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { App } from 'supertest/types';

export interface TestApp {
  app: INestApplication<App>;
  close: () => Promise<void>;
}

/**
 * Boots the full AppModule against an in-memory MongoDB.
 * Env must be set before AppModule is imported, because ConfigModule
 * validates it at import time.
 */
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<TestApp> {
  const mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGO_URI: mongo.getUri(),
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    ...env,
  });

  // Loaded lazily (not via import()) so the env above is in place first;
  // Jest's CommonJS runtime does not support dynamic import().
  const { AppModule } = jest.requireActual<
    typeof import('../../src/app.module')
  >('../../src/app.module');
  const { configureApp } = jest.requireActual<
    typeof import('../../src/app.setup')
  >('../../src/app.setup');

  let app: INestApplication<App>;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
  } catch (err) {
    // Otherwise the orphaned mongod keeps Jest from exiting.
    await mongo.stop();
    throw err;
  }

  return {
    app,
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
