import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'fs/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { tmpdir } from 'os';
import { join } from 'path';
import { App } from 'supertest/types';

export interface TestApp {
  app: INestApplication<App>;
  /** Throwaway UPLOAD_DIR for this app; the project's uploads/ is never touched. */
  uploadDir: string;
  close: () => Promise<void>;
}

/**
 * Boots the full AppModule against an in-memory MongoDB and a temporary
 * upload directory. Env must be set before AppModule is imported, because
 * ConfigModule validates it at import time.
 */
export async function createTestApp(
  env: Record<string, string> = {},
): Promise<TestApp> {
  const mongo = await MongoMemoryServer.create();
  const uploadDir = await mkdtemp(join(tmpdir(), 'e2e-uploads-'));
  Object.assign(process.env, {
    MONGO_URI: mongo.getUri(),
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    UPLOAD_DIR: uploadDir,
    ...env,
  });

  const cleanup = async () => {
    await mongo.stop();
    await rm(uploadDir, { recursive: true, force: true });
  };

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
    await cleanup();
    throw err;
  }

  return {
    app,
    uploadDir,
    close: async () => {
      await app.close();
      await cleanup();
    },
  };
}
