import request from 'supertest';
import { TestApp, createTestApp } from './utils/test-app';

interface Operation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: { name: string; in: string; schema?: Record<string, unknown> }[];
  requestBody?: {
    content: Record<string, { schema: Record<string, unknown> }>;
  };
  responses: Record<
    string,
    { content?: Record<string, { schema: Record<string, unknown> }> }
  >;
}
interface Schema {
  properties?: Record<string, Record<string, unknown>>;
}
interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, Schema>;
    securitySchemes: Record<string, unknown>;
  };
}

/** Routes anyone can call without a token. */
const PUBLIC = [
  'post /auth/register',
  'post /auth/login',
  'post /auth/refresh',
  'get /health',
];

/**
 * Audits /docs-json (T9), so an endpoint added or changed later without its
 * docs fails here instead of surprising someone in Swagger UI.
 */
describe('Swagger document (e2e)', () => {
  let testApp: TestApp;
  let doc: OpenApi;
  let ops: [string, Operation][];

  const op = (key: string) => ops.find(([k]) => k === key)![1];
  const codes = (o: Operation) => Object.keys(o.responses);

  beforeAll(async () => {
    testApp = await createTestApp();
    const res = await request(testApp.app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    doc = res.body as OpenApi;
    ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(
        ([method, o]) => [`${method} ${path}`, o] as [string, Operation],
      ),
    );
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('lists exactly the 13 endpoints of the API', () => {
    expect(ops.map(([k]) => k).sort()).toEqual(
      [
        'post /auth/register',
        'post /auth/login',
        'post /auth/refresh',
        'post /auth/logout',
        'get /users/me',
        'post /media/upload',
        'get /media/my',
        'get /media/{id}',
        'delete /media/{id}',
        'get /media/{id}/download',
        'get /media/{id}/permissions',
        'post /media/{id}/permissions',
        'get /health',
      ].sort(),
    );
  });

  it('gives every endpoint a summary, a tag and a readable operationId', () => {
    for (const [key, o] of ops) {
      expect({ key, summary: !!o.summary, tags: o.tags?.length }).toEqual({
        key,
        summary: true,
        tags: 1,
      });
      expect(o.operationId).toMatch(/^[a-z][A-Za-z]+$/);
    }
  });

  it('marks every protected endpoint with Bearer auth and documents 401', () => {
    expect(doc.components.securitySchemes).toHaveProperty('bearer');
    for (const [key, o] of ops.filter(([k]) => !PUBLIC.includes(k))) {
      expect({ key, security: o.security }).toEqual({
        key,
        security: [{ bearer: [] }],
      });
      expect({ key, codes: codes(o) }).toEqual({
        key,
        codes: expect.arrayContaining(['401']) as unknown,
      });
    }
  });

  it('leaves the public endpoints without Bearer auth', () => {
    for (const key of PUBLIC) {
      expect(op(key).security).toBeUndefined();
    }
  });

  it('documents 429 everywhere except /health', () => {
    for (const [key, o] of ops) {
      expect({ key, has429: codes(o).includes('429') }).toEqual({
        key,
        has429: key !== 'get /health',
      });
    }
  });

  it('documents 400, 404 and a plain string id on every /media/{id} route', () => {
    for (const [key, o] of ops.filter(([k]) => k.includes('{id}'))) {
      expect({ key, codes: codes(o) }).toEqual({
        key,
        codes: expect.arrayContaining(['400', '404']) as unknown,
      });
      const id = o.parameters?.find((p) => p.name === 'id');
      expect({ key, type: id?.schema?.type }).toEqual({ key, type: 'string' });
    }
  });

  it('documents 403 where access depends on ownership or sharing', () => {
    for (const [key, o] of ops.filter(([k]) => k.includes('{id}'))) {
      expect({ key, codes: codes(o) }).toEqual({
        key,
        codes: expect.arrayContaining(['403']) as unknown,
      });
    }
  });

  it('gives every error response the shared { statusCode, message, error } body', () => {
    for (const [key, o] of ops) {
      for (const [code, response] of Object.entries(o.responses)) {
        if (Number(code) < 400) continue;
        expect({
          key,
          code,
          ref: response.content?.['application/json']?.schema.$ref,
        }).toEqual({
          key,
          code,
          ref: '#/components/schemas/ErrorResponseDto',
        });
      }
    }
  });

  it('describes the upload as a multipart file field and 413 for large files', () => {
    const upload = op('post /media/upload');

    expect(
      upload.requestBody?.content['multipart/form-data'].schema,
    ).toMatchObject({
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    });
    expect(codes(upload)).toEqual(expect.arrayContaining(['400', '413']));
  });

  it('describes the download as a binary JPEG', () => {
    expect(op('get /media/{id}/download').responses['200'].content).toEqual({
      'image/jpeg': { schema: { type: 'string', format: 'binary' } },
    });
  });

  it('gives every DTO property an example', () => {
    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      for (const [prop, def] of Object.entries(schema.properties ?? {})) {
        // Nested DTOs ($ref / array of $ref) carry their own examples.
        const nested =
          '$ref' in def ||
          (def.items as Record<string, unknown> | undefined)?.$ref;
        expect({
          dto: `${name}.${prop}`,
          example: nested || 'example' in def,
        }).toEqual({
          dto: `${name}.${prop}`,
          example: nested || true,
        });
      }
    }
  });
});
