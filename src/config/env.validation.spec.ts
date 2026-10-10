import { envValidationSchema } from './env.validation';

const requiredEnv = {
  MONGO_URI: 'mongodb://localhost:27017/test',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

describe('envValidationSchema', () => {
  it('accepts the required variables and fills in defaults', () => {
    const result = envValidationSchema.validate(requiredEnv);
    if (result.error) throw result.error;

    expect(result.value).toMatchObject({
      PORT: 3000,
      UPLOAD_DIR: './uploads',
      MAX_FILE_SIZE: 5242880,
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      THROTTLE_TTL: 60000,
      THROTTLE_LIMIT: 100,
      THROTTLE_AUTH_LIMIT: 10,
      TRUST_PROXY: false,
    });
  });

  it.each(['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'])(
    'rejects the config when %s is missing',
    (key) => {
      const env: Record<string, string> = { ...requiredEnv };
      delete env[key];

      const { error } = envValidationSchema.validate(env);

      expect(error?.message).toContain(key);
    },
  );

  it('rejects a MONGO_URI that is not a mongodb connection string', () => {
    const { error } = envValidationSchema.validate({
      ...requiredEnv,
      MONGO_URI: 'http://example.com',
    });

    expect(error?.message).toContain('MONGO_URI');
  });

  it('converts numeric and boolean strings', () => {
    const result = envValidationSchema.validate({
      ...requiredEnv,
      PORT: '8080',
      TRUST_PROXY: 'true',
    });
    if (result.error) throw result.error;

    expect(result.value).toMatchObject({ PORT: 8080, TRUST_PROXY: true });
  });
});
