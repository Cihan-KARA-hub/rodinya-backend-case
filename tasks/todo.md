# Görev Listesi

Plan: [`plan.md`](plan.md) · Spec: [`SPEC.md`](../SPEC.md)

## Faz 1: İskelet ve Kimlik

- [x] **T1: Proje iskeleti + health**
  - Kabul: Nest 11 projesi kurulu. `ConfigModule` + Joi şeması (eksik env'de açılış hatası verir), `DatabaseModule` (`MongooseModule.forRootAsync` + ortak şema ayarları), global `ValidationPipe` (whitelist, transform), Swagger `/docs`'ta Bearer şemasıyla açılıyor. `GET /health` → `{status:'ok', db:'up'}`, DB yoksa 503. `.gitignore` (`.env`, `uploads/*`, `dist`, `node_modules`, `coverage`), `.env.example`, `uploads/.gitkeep` hazır. `enableShutdownHooks`, `0.0.0.0` dinleme yapılandırılmış.
  - Doğrula: `npm run build`, `npm run lint`, health e2e testi (mongodb-memory-server)
  - Dosyalar: `package.json`, `src/main.ts`, `src/app.module.ts`, `src/config/*`, `src/database/database.module.ts`, `src/database/base-schema.options.ts`, `src/health/*`, `test/health.e2e-spec.ts`

- [x] **T1.5: CI (GitHub Actions)**
  - Kabul: `.github/workflows/ci.yml`; `development` ve `main`'e açılan PR'larda ve bu branch'lere push'ta çalışır. Node 22, `npm ci`, `npm run lint:check`, `npm run build`, `npm test`, `npm run test:e2e`. npm ve mongodb-memory-server binary cache'i var. `package.json`'a düzeltme yapmayan `lint:check` script'i eklenir.
  - Doğrula: Bu görevin PR'ında workflow yeşil. Kasıtlı bir lint hatasıyla kırmızıya döndüğü bir kez görülür.
  - Dosyalar: `.github/workflows/ci.yml`, `package.json`

- [x] **T2: Users + register/login + /users/me**
  - Kabul: User şeması (email unique + lowercase). Register → 201 + token'lar, aynı email → 409. Şifre kuralı (A13) → 400. Login → 200, hatalı → 401 (genel mesaj). `JwtStrategy` + `JwtAuthGuard`, `@CurrentUser()`. `/users/me` passwordHash döndürmüyor.
  - Doğrula: `AuthService` unit testleri + `auth.e2e-spec.ts`
  - Dosyalar: `src/users/*`, `src/auth/*`, `src/common/decorators/current-user.decorator.ts`, `test/auth.e2e-spec.ts`

- [ ] **T3: Refresh token**
  - Kabul: `POST /auth/refresh {refreshToken}` → yeni çift döner. Payload'daki `type: 'access' | 'refresh'` kontrol ediliyor: refresh token Bearer olarak → 401, access token refresh'e → 401. Süresi dolmuş → 401.
  - Doğrula: unit + e2e
  - Dosyalar: `src/auth/*`, `test/auth.e2e-spec.ts`

### ✅ KN-1: Auth akışı uçtan uca geçiyor, Swagger "Authorize" çalışıyor

## Faz 2: Medya Çekirdeği

- [ ] **T4: Upload + /media/my**
  - Kabul: Media şeması (`ownerId`, `allowedUserIds` index'li). `MediaStorageService` (`<uuid>.jpg` yazar, stream açar, siler, `UPLOAD_DIR`'i açılışta oluşturur). Upload → 201. PNG / sahte uzantılı dosya (magic byte) → 400, dosya yok → 400, >5MB → 413. `/media/my` sadece sahibin kayıtlarını döndürüyor. Yanıtta `filePath` yok.
  - Doğrula: e2e (jpeg fixture, png fixture, 5MB+1 buffer)
  - Dosyalar: `src/media/schemas/*`, `src/media/media-storage.service.ts`, `src/media/media.service.ts`, `src/media/media.controller.ts`, `src/media/validators/jpeg-file.validator.ts`, `test/media.e2e-spec.ts`, `test/fixtures/*`

- [ ] **T5: Erişim guard'ı + detay + indirme**
  - Kabul: `ParseObjectIdPipe` (bozuk id → 400). `MediaAccessGuard` + `@OwnerOnly()` metadata: 404 / 403 / geçiş (sahip, izinli, admin). `GET /media/:id` meta döner (`allowedUserIds` yalnızca sahibe). `/download` `StreamableFile` döner; `Content-Type: image/jpeg`, `Content-Disposition: attachment; filename="<orijinal>"`, byte'lar orijinalle aynı. `/uploads/<dosya>` → 404.
  - Doğrula: guard unit testleri + e2e (A yükler, B → 403)
  - Dosyalar: `src/common/pipes/parse-object-id.pipe.ts`, `src/media/guards/*`, `src/media/decorators/owner-only.decorator.ts`, `src/media/media.controller.ts`, `test/media.e2e-spec.ts`

- [ ] **T6: Silme + izin yönetimi**
  - Kabul: `DELETE` → 204; kayıt ve dosya siliniyor, izinli kullanıcı silmeye çalışırsa → 403. `GET /permissions` sadece sahip. `POST /permissions {userId, action}`: `add` idempotent, `remove` çalışıyor. Hedef kullanıcı yok → 404, kendine izin → 400, geçersiz action → 400. İzin eklenince B indirebiliyor, kaldırılınca → 403.
  - Doğrula: `MediaService` unit + e2e (tam izin senaryosu)
  - Dosyalar: `src/media/dto/update-permission.dto.ts`, `src/media/media.service.ts`, `src/media/media.controller.ts`, `test/media.e2e-spec.ts`

### ✅ KN-2: Case'teki bütün medya senaryoları e2e testlerde geçiyor

## Faz 3: Ekstralar

- [ ] **T7: Admin**
  - Kabul: `npm run seed:admin` `ADMIN_EMAIL`/`ADMIN_PASSWORD` ile admin oluşturuyor ya da var olan kaydı güncelliyor (idempotent). Admin başkasının medyasını görüyor, indiriyor ve siliyor; permissions'a erişirse → 403. Token payload'ında `role` var.
  - Doğrula: e2e (admin senaryosu), script'i yerelde bir kez çalıştırma
  - Dosyalar: `src/database/seeds/seed-admin.ts`, `package.json`, `test/admin.e2e-spec.ts`

- [ ] **T8: Rate limiting**
  - Kabul: `ThrottlerModule` env'den yapılandırılıyor, global `ThrottlerGuard` aktif. Auth endpoint'lerinde sıkı limit var, `/health` `@SkipThrottle()` ile muaf. Limit aşılınca 429 dönüyor. `TRUST_PROXY=true` ise `app.set('trust proxy', 1)` uygulanıyor.
  - Doğrula: düşük limitli e2e testi (11. login isteği → 429)
  - Dosyalar: `src/app.module.ts`, `src/main.ts`, `src/auth/auth.controller.ts`, `src/health/health.controller.ts`, `test/throttle.e2e-spec.ts`

- [ ] **T9: Swagger denetimi**
  - Kabul: Bütün korumalı endpoint'lerde `@ApiBearerAuth()` var. 400/401/403/404/413/429 yanıtları belgelenmiş. Upload için `@ApiConsumes('multipart/form-data')` + dosya şeması tanımlı, download için binary yanıt belgelenmiş. DTO'larda örnek değerler var.
  - Doğrula: `/docs-json` üzerinde bütün yolları ve security'yi kontrol eden bir e2e testi + Swagger UI'da elle deneme
  - Dosyalar: controller'lar, DTO'lar, `test/swagger.e2e-spec.ts`

### ✅ KN-3: Ekstralar tamam, coverage ≥ %80 (servis ve guard'larda)

## Faz 4: Docker ve Teslim

- [ ] **T10: Docker**
  - Kabul: Multi-stage `Dockerfile` (`node:22-alpine`; build stage → runtime stage, `npm ci --omit=dev`, `USER node`, `HEALTHCHECK`). `.dockerignore` hazır. `docker-compose.yml` iki servis içeriyor: `api` (env_file, `uploads` volume, `depends_on: mongo` healthy durumda) ve `mongo:7` (`mongo-data` volume, healthcheck).
  - Doğrula: `docker compose up --build -d` → `/health` 200, upload/download çalışıyor, `docker compose restart api` sonrası dosya hâlâ indirilebiliyor
  - Dosyalar: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`

- [ ] **T11: README + son doğrulama**
  - Kabul: README'de kurulum (yerel / Docker / Atlas), env tablosu, endpoint tablosu, cURL örnekleri (PNG notu dahil) ve tasarım kararları (A1–A18) var. `build`, `lint`, `test`, `test:e2e`, `test:cov` hepsi geçiyor.
  - Doğrula: temiz bir klonla sıfırdan kurulum
  - Dosyalar: `README.md`, `.env.example`

### ✅ KN-4: Teslime hazır (GitHub remote'u eklenip push edilmesi size ait)
