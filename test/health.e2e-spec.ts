import { getConnectionToken } from '@nestjs/mongoose';
import { OpenAPIObject } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import request from 'supertest';
import { TestApp, createTestApp } from './utils/test-app';

describe('Health & bootstrap (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('GET /health returns ok without auth', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('serves the OpenAPI document with a bearer security scheme', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const doc = res.body as OpenAPIObject;
    expect(doc.paths).toHaveProperty('/health');
    expect(doc.components?.securitySchemes).toHaveProperty('bearer');
  });

  it('returns 404 in the standard error format for unknown routes', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/does-not-exist')
      .expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  // Keep last: closes the DB connection.
  it('GET /health returns 503 when the database is down', async () => {
    await testApp.app.get<Connection>(getConnectionToken()).close();

    const res = await request(testApp.app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(res.body).toMatchObject({ statusCode: 503 });
  });
});
