# Spec: Medya Kütüphanesi REST API (NestJS + MongoDB Atlas + JWT)

> Durum: **ONAYLANDI (2026-10-10)**. Çalışma branch'i `development`.

## Amaç

Kullanıcıların kayıt olup giriş yapabildiği, JPEG görsel yükleyebildiği ve yükledikleri görselleri
dosya bazında başka kullanıcılarla paylaşabildiği bir REST API.

- Fiziksel dosyalar `UPLOAD_DIR` (varsayılan `./uploads`) altında tutulur. Her yükleme `media` koleksiyonuna kaydedilir.
- Bir görsele yalnızca **sahibi** ve sahibin **izin verdiği kullanıcılar** erişebilir.
- Statik dosya servisi yoktur. Bütün dosya erişimi controller + guard üzerinden, stream olarak yapılır.
- API Swagger (OpenAPI) ile belgelenir. Proje public bir GitHub reposu olarak teslim edilir.

**Kullanıcı:** Case'i değerlendirecek backend mühendisi. Repoyu klonlayıp `.env` dosyasını doldurmalı,
`npm run start:dev` ile API'yi ayağa kaldırmalı ve Swagger UI'dan bütün akışı deneyebilmeli.

## Kararlar ve Varsayımlar

| # | Konu | Karar |
|---|------|----------|
| A1 | Refresh token | **Oturum tabanlı, rotation + çalınma tespiti** *(T3'te onaylandı; önceki stateless kararın yerine geçer)*. Her login/register bir `sessions` kaydı açar (cihaz başına bir oturum). Token'lar ayrı secret'larla imzalanır ve payload'daki `type` alanıyla ayrılır, biri diğerinin yerine kullanılamaz. Access token `sid`, refresh token `sid` + `jti` taşır. **Rotation:** `POST /auth/refresh` yalnızca oturumun güncel `jti`'sine sahip refresh token'ı kabul eder, yeni çift döner ve `currentJti`'yi değiştirir; eski refresh token anında geçersiz olur. **Çalınma tespiti:** eski (`jti`'si güncel olmayan) bir refresh token gelirse oturumun tamamı silinir ve 401 döner. **Logout:** `POST /auth/logout` oturumu siler. **Anında etki:** `JwtStrategy` her istekte oturumun hâlâ var olduğunu kontrol eder; logout veya çalınma tespitinden sonra o oturumun access token'ı da 401 alır. Her refresh oturumun süresini yeniden 7 gün uzatır (kayan oturum). Süresi dolan oturumları MongoDB TTL index'i siler. |
| A2 | Token süreleri | Access 15 dk, refresh 7 gün. İsteğe bağlı `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` env değişkenleriyle değiştirilebilir. |
| A3 | `admin` rolü | *(T5'te güncellendi)* `role: 'user' \| 'admin'` alanı vardır; admin hesabı `npm run seed:admin` script'iyle oluşturulur (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, idempotent). Kayıtla açılan her hesap `user` olur. **Admin'in medya üzerinde hiçbir global yetkisi yoktur:** bir görsele yalnızca sahibi ve sahibin izin verdiği kullanıcılar erişebilir; admin de sahip ya da izinli değilse 403 alır. Medya erişim kontrolünde rol hiç kullanılmaz. |
| A4 | İzin kapsamı | İzinli kullanıcı yalnızca **görüntüleyebilir**: `GET /media/:id` ve `/download`. Silme ve izin yönetimi (`GET`/`POST /permissions`) yalnızca sahibe açıktır. |
| A5 | `GET /media/my` | Sadece kullanıcının **sahibi olduğu** medyalar listelenir (paylaşılanlar dahil değildir). En yeni en üstte. **Sayfalı** *(T4'te eklendi)*: `?page=1&limit=20` (varsayılan 1 / 20, `limit` en fazla 100); geçersiz değer → 400. Yanıt `{ items, page, limit, total, totalPages }`. |
| A6 | 404 ve 403 ayrımı | Kayıt yoksa 404, kayıt var ama erişim yoksa 403 döner (case 403 istiyor). Geçersiz ObjectId → 400. |
| A7 | JPEG doğrulama | Hem `mimetype === image/jpeg` hem de dosyanın ilk byte'ları (`FF D8 FF`) kontrol edilir. Örnek cURL'deki `image.png` **reddedilir**. |
| A8 | Hata kodları | JPEG değil → 400, 5MB üstü → 413, dosya yok → 400, e-posta zaten kayıtlı → 409, hatalı login → 401 (genel mesaj). |
| A9 | Dosya adı | Diskte **kullanıcı başına klasörde** `<UPLOAD_DIR>/<userId>/<uuid>.jpg` olarak saklanır *(T4'te güncellendi)*. `filePath` bu dosyanın `UPLOAD_DIR`'e göre göreli yoludur (`<userId>/<uuid>.jpg`) ve API yanıtlarında **gösterilmez**. Dosya önce bellekte doğrulanır, sonra diske yazılır; DB kaydı başarısız olursa dosya silinir. `fileName` orijinal addır: multipart'tan UTF-8 okunur (`fotoğraf.jpg` bozulmaz) ve kaydedilmeden önce temizlenir — yol parçaları atılır (yalnızca son kısım), kontrol ve görünmez yön karakterleri silinir, NFC'ye normalize edilir, baş/son boşluk kırpılır, 255 karaktere kısaltılır (uzantı korunur), boş kalırsa `image.jpg`. İndirmede `Content-Disposition` RFC 6266'ya göre kodlanır (`filename*=UTF-8''...`). |
| A10 | Yanıt şekli | `passwordHash` hiçbir yanıtta dönmez. `allowedUserIds` yalnızca **sahibe** gösterilir (izinli kullanıcılar ve admin görmez). Yanıtlar alanları açıkça seçen DTO'larla üretilir, `filePath` hiç dönmez. |
| A11 | Permissions body | `{ "userId": "<ObjectId>", "action": "add" \| "remove" }`. `userId` 24 haneli hex değilse veya `action` geçersizse 400. `add` idempotenttir (`$addToSet`); hedef kullanıcı yoksa 404. `remove` de idempotenttir (`$pull`) ve *(T6'da netleşti)* hedef kullanıcının var olmasını **istemez**: silinmiş bir kullanıcı da listeden çıkarılabilir. Sahip kendine izin veremez / kendini çıkaramaz (400). Sahip kontrolü ve güncelleme tek atomik işlemdir. İzinli kullanıcı sayısında üst sınır yoktur. |
| A12 | Silme | `DELETE /media/:id` hem DB kaydını hem diskteki dosyayı siler. Yanıt 204. *(T6'da netleşti)* Sıra: önce kayıt (sahip kontrolüyle tek atomik işlem), sonra dosya. Dosya silinemezse hata loglanır ve yine 204 döner; en kötü durumda diskte kullanıcıya görünmeyen sahipsiz bir dosya kalır, "kaydı var dosyası yok" durumu oluşmaz. Boş kalan kullanıcı klasörü silinmez. |
| A13 | Şifre kuralı | En az 8 karakter, en az bir harf ve bir rakam içerir. **En fazla 72 byte** olabilir: bcrypt 72 byte'tan sonrasını sessizce yok saydığı için daha uzun şifre register'da ve login'de 400 döner. Sınır karakter değil byte'tır (`ğ`, `ş` gibi harfler UTF-8'de 2 byte). bcrypt ile hash'lenir (cost 10). |
| A14 | Health | `GET /health` auth gerektirmez, `{ status, db }` döner. DB bağlantısı yoksa 503. |
| A15 | Testler | Testler Atlas'a değil `mongodb-memory-server` ile bellek içi Mongo'ya bağlanır. |
| A16 | Rate limiting | *(Onaylandı; T8'de netleşti)* `@nestjs/throttler` global guard olarak, kimlik doğrulamadan **önce** çalışır (token'sız istekler de sayılır, 429 401'den önce gelir). Sayaç **IP + endpoint** başınadır (paketin varsayılanı, bilerek korundu): her endpoint için IP başına 60 sn'de 100 istek. `/auth/login`, `/auth/register` ve `/auth/refresh` ayrıca `@AuthThrottle()` ile daha sıkı bir sayaca tabidir: her biri için IP başına 60 sn'de 10 istek. Limit aşılınca 429 `{ statusCode, message, error }` ve standart `Retry-After` başlığı döner. Değerler env ile ayarlanabilir (`THROTTLE_TTL`, `THROTTLE_LIMIT`, `THROTTLE_AUTH_LIMIT`). `/health` limitten muaftır. `TRUST_PROXY=true` ise istemci IP'si `X-Forwarded-For`'dan alınır (tek proxy katmanı); proxy yokken açmak limitin atlatılmasına yol açar, varsayılan `false`. Sayaçlar bellektedir (süreç başına). |
| A17 | Docker | *(Onaylandı)* Multi-stage `Dockerfile` (`node:22-alpine`, root olmayan kullanıcı, sadece prod bağımlılıkları), `.dockerignore`, `docker-compose.yml` (`api` + `mongo` servisleri, `uploads` ve `mongo-data` volume'ları, `/health` üzerinden healthcheck). Compose varsayılan olarak yerel `mongo` konteynerine bağlanır. `.env` içinde `MONGO_URI` Atlas'ı gösterirse aynı image Atlas ile çalışır. Uygulama container'a hazırdır: `0.0.0.0` dinler, config yalnızca env'den gelir, SIGTERM'de düzgün kapanır (`enableShutdownHooks`), `UPLOAD_DIR` yoksa açılışta oluşturulur. |
| A18 | Database modülü | `src/database/` altında bağlantı modülü, ortak şema ayarları ve seed'ler bulunur. **Migration altyapısı ve soft delete (`deletedAt`) yoktur.** Mongo şemasız olduğu için şema migration'ı gerekmez. Index'ler Mongoose şemasında tanımlanır ve geliştirmede `autoIndex` ile oluşur. Ortak alanlar base class ile değil, ortak `SchemaOptions` ile verilir. Veri dönüşümü gerekirse ileride `migrate-mongo` eklenebilir. |

## Teknoloji Yığını

- Node.js 22 LTS, npm
- Docker + Docker Compose
- NestJS 11, TypeScript (strict)
- `@nestjs/mongoose` + Mongoose 8 (MongoDB Atlas)
- `@nestjs/jwt` + `@nestjs/passport` + `passport-jwt`
- `@nestjs/config` + Joi (env doğrulaması: uygulama eksik env değişkeniyle açılmaz)
- `@nestjs/swagger`
- `class-validator` / `class-transformer`
- `multer` (Nest'in `FileInterceptor`'ı), `bcrypt`
- `@nestjs/throttler`
- Test: Jest, Supertest, `mongodb-memory-server`
- CI: GitHub Actions (her PR'da lint, build, unit ve e2e testleri)

## Komutlar

```
Kurulum:    npm install
Geliştirme: npm run start:dev
Build:      npm run build
Prod:       npm run start:prod
Lint:       npm run lint
Format:     npm run format
Unit test:  npm test
E2E test:   npm run test:e2e
Coverage:   npm run test:cov
Admin seed: npm run seed:admin
Lint (CI): npm run lint:check   # düzeltme yapmaz, hata varsa kırılır
Swagger:    http://localhost:3000/docs

Docker:
  docker compose up --build -d     # api + yerel mongo
  docker compose logs -f api
  docker compose down              # volume'lar korunur (-v ile silinir)
  docker build -t backend-case-api .
```

## Ortam Değişkenleri

`.env.example` repoya eklenir, `.env` eklenmez.

```
MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
JWT_ACCESS_EXPIRES_IN=15m      # opsiyonel
JWT_REFRESH_EXPIRES_IN=7d      # opsiyonel
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880
PORT=3000
THROTTLE_TTL=60000             # opsiyonel, ms
THROTTLE_LIMIT=100             # opsiyonel
THROTTLE_AUTH_LIMIT=10         # opsiyonel
TRUST_PROXY=false              # opsiyonel
ADMIN_EMAIL=                   # yalnızca seed:admin için
ADMIN_PASSWORD=                # yalnızca seed:admin için
```

## Veri Modeli

**users**: `_id`, `email` (unique, lowercase), `passwordHash`, `role: 'user' | 'admin'` (varsayılan `user`), `createdAt`, `updatedAt`

**sessions**: `_id` (oturum id'si, token'larda `sid`), `userId` (ref users, index), `currentJti` (geçerli refresh token'ın id'si), `expiresAt` (TTL index: süresi dolunca MongoDB siler), `createdAt`, `updatedAt`. Token'ın kendisi saklanmaz.

**media**: `_id`, `ownerId` (ref users, index), `fileName` (temizlenmiş orijinal ad), `filePath` (`<userId>/<uuid>.jpg`, `UPLOAD_DIR`'e göre göreli), `mimeType`, `size`, `allowedUserIds: ObjectId[]` (varsayılan `[]`, index), `createdAt`

## REST Uç Noktaları

| Metot | Yol | Auth | Kim | Başarı | Hatalar |
|---|---|---|---|---|---|
| POST | `/auth/register` | – | herkes | 201 `{ user, accessToken, refreshToken }` | 400, 409 |
| POST | `/auth/login` | – | herkes | 200 `{ accessToken, refreshToken }` | 400, 401 |
| POST | `/auth/refresh` | refresh token (body) | herkes | 200 `{ accessToken, refreshToken }` | 400, 401 |
| POST | `/auth/logout` | Bearer | giriş yapmış | 204 (bu oturum kapanır) | 401 |
| GET | `/users/me` | Bearer | giriş yapmış | 200 `{ id, email, role, createdAt }` | 401 |
| POST | `/media/upload` | Bearer | giriş yapmış | 201 medya | 400, 401, 413 |
| GET | `/media/my?page&limit` | Bearer | giriş yapmış | 200 `{ items: medya[], page, limit, total, totalPages }` | 400, 401 |
| GET | `/media/:id` | Bearer | sahip + izinli | 200 medya meta | 400, 401, 403, 404 |
| GET | `/media/:id/download` | Bearer | sahip + izinli | 200 stream (`image/jpeg`, `Content-Disposition: attachment`, `nosniff`, CSP sandbox, `no-store`) | 400, 401, 403, 404 |
| DELETE | `/media/:id` | Bearer | sahip | 204 | 400, 401, 403, 404 |
| GET | `/media/:id/permissions` | Bearer | sahip | 200 `{ mediaId, allowedUserIds }` | 400, 401, 403, 404 |
| POST | `/media/:id/permissions` | Bearer | sahip | 200 `{ mediaId, allowedUserIds }` | 400, 401, 403, 404 |
| GET | `/health` | – | herkes | 200 `{ status: 'ok', db: 'up' }` | 503 |

Hata gövdesi Nest'in standart formatındadır: `{ statusCode, message, error }`. Rate limit aşılınca, `/health` hariç bütün endpoint'ler 429 dönebilir.

## Proje Yapısı

```
src/
  main.ts                    → bootstrap, ValidationPipe, Swagger (/docs)
  app.module.ts
  config/                    → env şeması (Joi), typed config
  database/
    database.module.ts       → MongooseModule.forRootAsync (URI, autoIndex, bağlantı logları)
    base-schema.options.ts   → ortak şema ayarları: timestamps, toJSON (_id→id, __v ve gizli alanlar silinir)
    seeds/seed-admin.ts      → admin hesabı oluşturma (npm run seed:admin)
  common/
    decorators/              → @CurrentUser()
    pipes/                   → ParseObjectIdPipe
  auth/                      → controller, service, dto, jwt strategy, JwtAuthGuard
    sessions/                → session şeması + SessionsService (rotation, TTL)
  users/                     → schema, service, controller (/users/me)
  media/
    schemas/media.schema.ts
    dto/
    media.controller.ts
    media.service.ts               → dosya bazlı erişim kuralı (sahip / izinli) burada
    media-storage.service.ts       → diske yazma, okuma stream'i, silme
  health/                    → /health
test/                        → e2e testleri (supertest + mongodb-memory-server)
uploads/                     → .gitignore'da (yalnızca .gitkeep repoda)
Dockerfile                   → multi-stage, node:22-alpine, non-root
.dockerignore
docker-compose.yml           → api + mongo, volume'lar, healthcheck
.env.example
README.md                    → kurulum, env, cURL örnekleri, tasarım kararları
```

## Kod Stili

- NestJS konvansiyonları: modül başına klasör, dosyalarda `kebab-case.type.ts`, sınıflarda `PascalCase`.
- Prettier + ESLint (Nest CLI varsayılanları), tek tırnak, noktalı virgül.
- Kimlik doğrulama guard'da, biçim doğrulama pipe'ta, iş ve dosya bazlı erişim kuralları service'te. Controller ince tutulur.
- Bütün DTO'lar `class-validator` ile doğrulanır ve `@ApiProperty` ile belgelenir.

Erişim katmanları *(T5'te belirlendi)*: kimlik doğrulama guard'da, biçim doğrulama pipe'ta, dosya bazlı yetki service'te.

```
İstek → JwtAuthGuard (global)       token, imza, süre, oturum, kullanıcı   → 401
      → ParseObjectIdPipe           :id 24 haneli hex mi? → Types.ObjectId → 400
      → Controller (ince)
      → MediaService                kayıt var mı?                          → 404
                                    sahip mi / izinli mi?                  → 403
```

```ts
// Controller: pipe string'i Types.ObjectId'ye çevirir; service ObjectId aldığı için
// pipe'ı unutmak derleme hatasıdır.
@Get(':id')
findOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId, @CurrentUser() user: AuthUser) {
  return this.mediaService.findForViewer(id, user.id);
}

// MediaService: kural tek yerde. Rol kontrolü yoktur (A3).
async findForViewer(id: Types.ObjectId, viewerId: string): Promise<MediaDocument> {
  const media = await this.mediaModel.findById(id);
  if (!media) throw new NotFoundException('Media not found');                    // 404
  const isOwner = media.ownerId.equals(viewerId);
  const isAllowed = media.allowedUserIds.some((u) => u.equals(viewerId));
  if (!isOwner && !isAllowed) throw new ForbiddenException('You do not have access to this media'); // 403
  return media;
}
```

## Test Stratejisi

- **Unit (Jest):** `AuthService` (hash, token üretimi, hatalı şifre), `MediaService` (izin ekleme/kaldırma kuralları), `MediaService` erişim kuralları (sahip / izinli / yabancı / admin), `ParseObjectIdPipe`, JPEG doğrulayıcı.
- **E2E (Supertest + mongodb-memory-server, geçici upload klasörü):**
  - register → login → refresh → `/users/me`
  - refresh rotation: eski refresh token tekrar kullanılırsa 401 ve oturum kapanır (aynı oturumun access token'ı da 401). Logout sonrası refresh ve access token → 401. Diğer cihazın oturumu etkilenmez.
  - upload JPEG (201), PNG (400), PNG içerikli sahte `.jpg` (400), dosya yok (400), 5MB üstü (413), token yok (401); dosya `UPLOAD_DIR/<userId>/<uuid>.jpg`'ye yazılır, Türkçe dosya adı bozulmaz
  - `/media/my` yalnızca sahibin kayıtları, en yeni en üstte, sayfalama ve geçersiz `page`/`limit` → 400
  - A kullanıcısı yükler, B → 403. A, B'ye izin verir, B indirir (200, byte'lar aynı). A izni kaldırır, B → 403
  - B (izinli) silmeye çalışır → 403, permissions görmeye çalışır → 403
  - Admin (sahip ya da izinli değil) A'nın medyasını görmeye/indirmeye/silmeye ya da permissions'ına erişmeye çalışır → 403
  - indirme başlıkları: `image/jpeg`, `attachment` + RFC 6266 dosya adı, `nosniff`, CSP sandbox, `no-store`; kayıt var ama dosya diskte yok → 404
  - var olmayan id → 404, bozuk id → 400
  - `/uploads/...` yolu → 404 (statik servis yok)
  - auth limiti aşılınca → 429
  - süresi dolmuş access token → 401, refresh token access yerine kullanılırsa → 401
- **Docker smoke:** `docker compose up --build` sonrası `/health` 200 döner, upload + download çalışır, konteyner yeniden başlatıldıktan sonra dosyalar korunur.
- Hedef: servis ve guard'larda ≥ %80 satır kapsamı. Spec'teki her endpoint en az bir e2e testiyle doğrulanır.

## Sınırlar

- **Her zaman:** commit öncesi lint + testleri çalıştır, input'ları DTO ile doğrula, `.env`'i repoya koyma, yanıtlarda hassas alanları (passwordHash, filePath) gizle.
- **Önce sor:** veri modeline alan eklemek (ör. refresh token hash), yukarıdaki listede olmayan bir bağımlılık eklemek, endpoint sözleşmesini değiştirmek, CI workflow'unu değiştirmek, force push, PR merge etmek.
- **Asla:** secret'ları commit'lemek, `uploads/` klasörünü statik olarak servis etmek, başarısız testleri silmek veya skip'lemek, `.env` içeriğini loglamak.

## Başarı Kriterleri

1. `npm run build`, `npm run lint`, `npm test` ve `npm run test:e2e` hatasız geçer.
2. Case'teki 12 endpoint ve eklenen `POST /auth/logout` çalışır ve Swagger'da görünür. Auth gerektirenler `@ApiBearerAuth()` ile işaretlidir, 401/403/404 yanıtları belgelenmiştir. Swagger UI'daki "Authorize" butonu ile token girilip istekler denenebilir.
3. Yalnızca JPEG ve ≤ 5MB dosya kabul edilir. Dosya `UPLOAD_DIR` altına yazılır ve `media` kaydı oluşturulur.
4. Yetkisiz kullanıcı, var olan bir medyaya erişirken 403 alır. İzin eklendikten sonra 200, kaldırıldıktan sonra yine 403 alır.
5. Diskteki dosyaya controller dışında hiçbir URL ile erişilemez.
6. `.env.example` ve README ile repo, yalnızca Atlas URI'si ve secret'lar girilerek çalıştırılabilir.
7. Admin dahil hiç kimse, sahibi ya da izinli değilse bir medyaya erişemez.
8. Rate limit aşılınca 429 döner.
9. `docker compose up --build` tek komutla API + Mongo'yu ayağa kaldırır, `/health` 200 döner, upload'lar volume'da kalıcıdır. Aynı image, `MONGO_URI` Atlas'a verilerek de çalışır.

## Açık Sorular

Yok. Bütün sorular 2026-10-10'da yanıtlandı (A1, A3, A16, A17, branch: `development`).
Repo: `https://github.com/Cihan-KARA-hub/rodinya-backend-case.git`. Git/GitHub akışı için bkz. [`tasks/plan.md`](tasks/plan.md#git-ve-github-akışı).
