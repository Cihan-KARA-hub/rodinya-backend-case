import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Shown at the top of /docs: how to try the whole flow from the UI. */
const GUIDE = `
JPEG upload and per-file sharing with JWT auth.

**Try it**
1. \`POST /auth/register\` (or \`/auth/login\`) and copy the \`accessToken\`.
2. Click **Authorize** and paste it (without "Bearer").
3. \`POST /media/upload\` a JPEG (max 5 MB), then \`GET /media/my\`.
4. Share it: \`POST /media/{id}/permissions\` with another user's id (they see it in \`GET /users/me\`).
5. That user can now \`GET /media/{id}\` and \`/download\` it; everyone else gets 403.

**Rules**
- Only the owner and the users the owner allowed can access a file; there is no global admin access.
- Access tokens last 15 minutes; get a new pair with \`POST /auth/refresh\`. A refresh token works once.
- Rate limits per IP and endpoint: 100 requests/min, and 10/min on login, register and refresh (429 with \`Retry-After\`).
- Errors share one shape: \`{ statusCode, message, error }\`.
`.trim();

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Media Library API')
    .setDescription(GUIDE)
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('auth', 'Register, log in, refresh and log out')
    .addTag('users', 'The current user')
    .addTag('media', 'Upload, list, view, download, delete and share JPEGs')
    .addTag('health', 'Liveness and database status')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    // "register", "upload"... instead of "AuthController_register".
    operationIdFactory: (_controllerKey, methodKey) => methodKey,
  });
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
}
