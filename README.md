# Medya Kütüphanesi REST API

[![CI](https://github.com/Cihan-KARA-hub/rodinya-backend-case/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/Cihan-KARA-hub/rodinya-backend-case/actions/workflows/ci.yml)

Kullanıcıların kayıt olup giriş yapabildiği, **JPEG** görsel yükleyebildiği ve yükledikleri görselleri **dosya bazında** başka kullanıcılarla paylaşabildiği bir REST API.

- Bir görsele **yalnızca sahibi ve sahibin izin verdiği kullanıcılar** erişebilir. Admin dahil başka hiç kimse erişemez.
- Dosyalar diskte (`UPLOAD_DIR`) tutulur, kayıtları MongoDB'dedir. **Statik dosya servisi yoktur.** Her erişim kimlik ve izin kontrolünden geçer, dosya stream olarak gönderilir.
- API, Swagger ile belgelenmiştir: **http://localhost:3000/docs**

**Teknolojiler:** Node.js 22 · NestJS 11 · TypeScript (strict) · MongoDB (Mongoose 8) · JWT (access + refresh, oturum tabanlı) · Multer · bcrypt · `@nestjs/throttler` · Swagger · Jest + Supertest + mongodb-memory-server · Docker

---

## İçindekiler
1. [Hızlı başlangıç](#hızlı-başlangıç)
2. [Kurulum](#kurulum): yerel / Docker / MongoDB Atlas
3. [Ortam değişkenleri](#ortam-değişkenleri)
4. [Endpoint'ler](#endpointler)
5. [cURL ile örnek akış](#curl-ile-örnek-akış)
6. [Admin hesabı](#admin-hesabı)
7. [Testler](#testler)
8. [Tasarım kararları](#tasarım-kararları)
9. [Güvenlik ve bilinen sınırlamalar](#güvenlik-ve-bilinen-sınırlamalar)
10. [Proje yapısı](#proje-yapısı)

---

## Hızlı başlangıç

Docker ile, tek komut. MongoDB kurmanıza gerek yok:

```bash
git clone https://github.com/Cihan-KARA-hub/rodinya-backend-case.git
cd rodinya-backend-case
cp .env.example .env          # Windows: copy .env.example .env
# .env içinde JWT_ACCESS_SECRET ve JWT_REFRESH_SECRET değerlerini değiştirin
docker compose up --build -d
```

Ardından **http://localhost:3000/docs** adresini açın. Swagger sayfasının başındaki **"Try it"** rehberi bütün akışı adım adım anlatır.

---

## Kurulum

### Gereksinimler
- **Node.js 22** ve npm (yerel çalıştırma için)
- **Docker** ve Docker Compose (Docker ile çalıştırma için)
- Bir MongoDB: yerel, Docker ya da **MongoDB Atlas**

### 1. Ortam dosyası
```bash
cp .env.example .env
```
En azından şunları doldurun:
- `MONGO_URI`: veritabanı adresi (aşağıya bakın)
- `JWT_ACCESS_SECRET` ve `JWT_REFRESH_SECRET`: **iki farklı**, uzun ve rastgele değer. Üretmek için:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

Eksik ya da geçersiz bir değişken varsa uygulama **açılmaz** ve hangi değerin eksik olduğunu yazar.

### 2a. Yerel çalıştırma
```bash
npm ci
npm run start:dev             # geliştirme (değişiklikte yeniden başlar)
# ya da
npm run build && npm run start:prod
```
`MONGO_URI` için yerel bir MongoDB yoksa Docker ile hızlıca açabilirsiniz:
```bash
docker run -d --name media-mongo -p 27017:27017 -v media-mongo-data:/data/db mongo:7
# .env:  MONGO_URI=mongodb://localhost:27017/media-library
```

### 2b. Docker ile
```bash
docker compose up --build -d      # API + MongoDB
docker compose logs -f api        # loglar
docker compose down               # durdur (veriler volume'larda kalır)
docker compose down -v            # durdur ve verileri sil
```
- İki servis açılır: `api` ve `mongo:7`. API, MongoDB sağlıklı olana kadar başlamaz.
- Yüklenen dosyalar `uploads` volume'unda, veritabanı `mongo-data` volume'unda tutulur. **Konteyner yeniden başlasa da veriler kaybolmaz.**
- Compose'daki MongoDB dışarıya port açmaz; yalnızca API ona erişir.
- Konteynerde `.env`'deki `MONGO_URI` **kullanılmaz** (o, Docker dışında çalıştırmak içindir). Docker'da veritabanı `DOCKER_MONGO_URI` ile seçilir; varsayılanı compose'daki MongoDB'dir.
- 3000 portu doluysa: `.env`'e `API_PORT=3001` yazın.

### 2c. MongoDB Atlas ile
1. [Atlas](https://www.mongodb.com/cloud/atlas)'ta bir cluster açın (ücretsiz katman yeterli).
2. **Database Access**: bir veritabanı kullanıcısı oluşturun.
3. **Network Access**: çalıştıracağınız makinenin IP'sine izin verin.
4. **Connect → Drivers** ekranındaki `mongodb+srv://...` adresini kopyalayın, sonuna veritabanı adını ekleyin.
5. Adresi kullanın:
   - Yerel çalıştırmada: `.env` → `MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>`
   - Docker'da: `.env` → `DOCKER_MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>`

Aynı Docker imajı hem compose'daki MongoDB ile hem Atlas ile çalışır. Index'ler uygulama açılırken otomatik oluşur, migration gerekmez.

Kurulumun çalıştığını kontrol etmek için:
```bash
curl http://localhost:3000/health
# {"status":"ok","db":"up"}
```

---

## Ortam değişkenleri

| Değişken | Zorunlu | Varsayılan | Açıklama |
|---|---|---|---|
| `MONGO_URI` | **evet** | – | MongoDB adresi (`mongodb://` veya `mongodb+srv://`) |
| `JWT_ACCESS_SECRET` | **evet** | – | Access token imza anahtarı |
| `JWT_REFRESH_SECRET` | **evet** | – | Refresh token imza anahtarı (access'ten farklı olmalı) |
| `JWT_ACCESS_EXPIRES_IN` | hayır | `15m` | Access token ömrü |
| `JWT_REFRESH_EXPIRES_IN` | hayır | `7d` | Refresh token ve oturum ömrü |
| `PORT` | hayır | `3000` | API portu |
| `NODE_ENV` | hayır | `development` | `development` / `production` / `test` |
| `UPLOAD_DIR` | hayır | `./uploads` | Dosyaların yazıldığı klasör (yoksa açılışta oluşturulur) |
| `MAX_FILE_SIZE` | hayır | `5242880` | Byte cinsinden en büyük dosya (5 MB) |
| `THROTTLE_TTL` | hayır | `60000` | Rate limit penceresi (ms) |
| `THROTTLE_LIMIT` | hayır | `100` | Pencere başına istek (IP + endpoint) |
| `THROTTLE_AUTH_LIMIT` | hayır | `10` | Register / login / refresh için daha sıkı limit |
| `TRUST_PROXY` | hayır | `false` | Yalnızca bir reverse proxy arkasındaysa `true` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yalnızca seed | – | `npm run seed:admin` için (uygulama kullanmaz) |
| `DOCKER_MONGO_URI` | yalnızca Docker | compose'daki mongo | Docker'da kullanılacak veritabanı (ör. Atlas) |
| `API_PORT` | yalnızca Docker | `3000` | Docker'da API'nin host portu |

---

## Endpoint'ler

Swagger: **http://localhost:3000/docs** · OpenAPI JSON: `/docs-json`

| Metot | Yol | Kimlik | Kim erişebilir | Başarı | Hatalar |
|---|---|---|---|---|---|
| POST | `/auth/register` | – | herkes | 201 `{ user, accessToken, refreshToken }` | 400, 409, 429 |
| POST | `/auth/login` | – | herkes | 200 `{ accessToken, refreshToken }` | 400, 401, 429 |
| POST | `/auth/refresh` | refresh token (body) | herkes | 200 `{ accessToken, refreshToken }` | 400, 401, 429 |
| POST | `/auth/logout` | Bearer | giriş yapmış | 204 | 401, 429 |
| GET | `/users/me` | Bearer | giriş yapmış | 200 `{ id, email, role, createdAt }` | 401, 429 |
| POST | `/media/upload` | Bearer | giriş yapmış | 201 medya | 400, 401, 413, 429 |
| GET | `/media/my?page&limit` | Bearer | giriş yapmış (yalnızca kendi medyası) | 200 `{ items, page, limit, total, totalPages }` | 400, 401, 429 |
| GET | `/media/:id` | Bearer | sahip + izinli | 200 medya | 400, 401, 403, 404, 429 |
| GET | `/media/:id/download` | Bearer | sahip + izinli | 200 dosya (`image/jpeg`, `attachment`) | 400, 401, 403, 404, 429 |
| DELETE | `/media/:id` | Bearer | sahip | 204 | 400, 401, 403, 404, 429 |
| GET | `/media/:id/permissions` | Bearer | sahip | 200 `{ mediaId, allowedUserIds }` | 400, 401, 403, 404, 429 |
| POST | `/media/:id/permissions` | Bearer | sahip | 200 `{ mediaId, allowedUserIds }` | 400, 401, 403, 404, 429 |
| GET | `/health` | – | herkes | 200 `{ status, db }` | 503 |

- **Hata gövdesi her yerde aynıdır:** `{ "statusCode": 403, "message": "...", "error": "Forbidden" }`.
- **Hata kodları:** bozuk id → 400 · kayıt yok → 404 · kayıt var ama erişim yok → 403 · JPEG değil / dosya yok → 400 · 5 MB üstü → 413 · aynı e-posta → 409 · limit aşıldı → 429 (`Retry-After` başlığıyla).
- Medya yanıtları: `{ id, ownerId, fileName, mimeType, size, createdAt }`. `allowedUserIds` **yalnızca sahibe** gösterilir. Sunucudaki dosya yolu hiçbir yanıtta yoktur.

---

## cURL ile örnek akış

Komutlar bash içindir (Linux, macOS, Git Bash). Windows PowerShell'de `curl` yerine `curl.exe` yazın.

> ⚠️ **Örnek cURL'deki `image.png` hakkında:** API **yalnızca JPEG** kabul eder. PNG dosyası, adı `.jpg` yapılmış olsa bile **400** döner, çünkü dosyanın içeriği de kontrol edilir (`FF D8 FF` imzası). Aşağıda gerçek bir JPEG kullanın, örneğin repodaki `test/fixtures/photo.jpg`.

```bash
API=http://localhost:3000

# 1) İki kullanıcı: Ali (sahip) ve Ayşe
curl -s -X POST $API/auth/register -H "Content-Type: application/json" \
  -d '{"email":"ali@example.com","password":"secret123"}'
curl -s -X POST $API/auth/register -H "Content-Type: application/json" \
  -d '{"email":"ayse@example.com","password":"secret123"}'

# 2) Giriş yap, token'ları al
ALI=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ali@example.com","password":"secret123"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
AYSE=$(curl -s -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ayse@example.com","password":"secret123"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
AYSE_ID=$(curl -s $API/users/me -H "Authorization: Bearer $AYSE" | sed -E 's/.*"id":"([^"]+)".*/\1/')

# 3) Ali bir JPEG yükler
MEDIA_ID=$(curl -s -X POST $API/media/upload -H "Authorization: Bearer $ALI" \
  -F "file=@test/fixtures/photo.jpg;type=image/jpeg" | sed -E 's/.*"id":"([^"]+)".*/\1/')

# 4) Ali kendi görsellerini listeler
curl -s "$API/media/my?page=1&limit=20" -H "Authorization: Bearer $ALI"

# 5) Ayşe henüz erişemez → 403
curl -s -o /dev/null -w "%{http_code}\n" $API/media/$MEDIA_ID -H "Authorization: Bearer $AYSE"

# 6) Ali, Ayşe'ye görüntüleme izni verir
curl -s -X POST $API/media/$MEDIA_ID/permissions -H "Authorization: Bearer $ALI" \
  -H "Content-Type: application/json" -d "{\"userId\":\"$AYSE_ID\",\"action\":\"add\"}"

# 7) Ayşe artık görür ve indirir → 200
curl -s $API/media/$MEDIA_ID -H "Authorization: Bearer $AYSE"
curl -s $API/media/$MEDIA_ID/download -H "Authorization: Bearer $AYSE" -o indirilen.jpg

# 8) Ali izni kaldırır → Ayşe tekrar 403 alır
curl -s -X POST $API/media/$MEDIA_ID/permissions -H "Authorization: Bearer $ALI" \
  -H "Content-Type: application/json" -d "{\"userId\":\"$AYSE_ID\",\"action\":\"remove\"}"

# 9) Ali görseli siler → 204
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE $API/media/$MEDIA_ID -H "Authorization: Bearer $ALI"
```

**Token yenileme ve çıkış:**
```bash
# Access token 15 dakikada dolar. Yeni çift almak için refresh token kullanın (her refresh token BİR kez geçerlidir):
curl -s -X POST $API/auth/refresh -H "Content-Type: application/json" -d '{"refreshToken":"<refreshToken>"}'

# Bu cihazdan çıkış: oturum kapanır, access ve refresh token'lar artık çalışmaz
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/auth/logout -H "Authorization: Bearer <accessToken>"
```

**Paylaşım için kullanıcı id'si:** API'de kullanıcı arama yoktur. Paylaşılacak kişi kendi id'sini `GET /users/me` ile görür ve sahibe iletir.

---

## Admin hesabı

```bash
# .env'e ekleyin:
#   ADMIN_EMAIL=admin@example.com
#   ADMIN_PASSWORD=<en az 8 karakter, harf ve rakam>

npm run seed:admin:dev                      # yerel (kaynaktan)
npm run seed:admin                          # yerel (npm run build sonrası)
docker compose exec api npm run seed:admin  # Docker
```
- Tekrar çalıştırmak güvenlidir: hesap yoksa oluşturur, `user` ise admin yapar, şifre değiştiyse günceller ve o hesabın bütün oturumlarını kapatır, aynıysa hiçbir şey yapmaz.
- Şifre kayıttaki kurallara tabidir ve hiçbir log'a yazılmaz.
- **Admin rolü medya üzerinde ayrıcalık vermez.** Admin de başkasının görseline ancak sahibi izin verirse erişebilir. Rol, ileride eklenebilecek yönetim işlevleri için altyapı olarak durur.

---

## Testler

```bash
npm test            # unit testler
npm run test:e2e    # uçtan uca testler (gerçek HTTP, bellek içi MongoDB)
npm run test:cov    # unit test kapsamı
npm run lint        # ESLint + Prettier (düzeltir); CI'da: npm run lint:check
```

- Testler gerçek veritabanına **dokunmaz**: `mongodb-memory-server` ile bellek içi bir MongoDB ve geçici bir upload klasörü kullanılır. İlk çalıştırmada MongoDB binary'si indirilir.
- **Unit (214):** servisler, oturum/rotation mantığı, erişim kuralı, JPEG doğrulayıcı, dosya adı temizleyici, storage (gerçek dosya sistemi), DTO'lar, guard'lar, admin seed.
- **E2E (132):** kimlik akışı ve token rotation/çalınma tespiti; upload (JPEG 201, PNG ve sahte `.jpg` 400, 5 MB üstü 413, dosya diske yazılıyor mu); tam paylaşım senaryosu (A yükler → B 403 → A izin verir → B indirir, byte'lar aynı → A kaldırır → B 403); sahip olmayan / izinli / admin için 403; 400/404; indirme başlıkları; rate limit; Swagger dokümanının kendisi.
- Servis ve guard'larda satır kapsamı **%90–100**. Controller ve modüller e2e testleriyle kapsanır.
- **CI:** her PR'da ve `development`/`main`'e push'ta GitHub Actions `npm ci → lint → build → test → test:e2e` çalıştırır. Bu branch'lere CI geçmeden merge edilemez.

---

## Tasarım kararları

Ayrıntılı gerekçeler [`SPEC.md`](SPEC.md) dosyasındadır (A1–A18). Özet:

| # | Konu | Karar |
|---|---|---|
| A1 | Refresh token | **Oturum tabanlı, rotation + çalınma tespiti.** Her login bir oturum açar (cihaz başına). Refresh token yalnızca bir kez kullanılabilir; kullanılmış bir refresh token tekrar gelirse oturum tamamen kapatılır (hem saldırgan hem gerçek kullanıcı çıkarılır). Logout ve çalınma tespiti access token'ı da **anında** geçersiz kılar. Token'ın kendisi saklanmaz, yalnızca kimliği (`jti`). |
| A2 | Token süreleri | Access 15 dk, refresh 7 gün; her refresh oturumu 7 gün uzatır. |
| A3 | Admin | Rol vardır ve seed ile oluşturulur, ama **medyaya global erişimi yoktur**. Kayıtla açılan her hesap `user`'dır; istemci rolünü kendisi seçemez. |
| A4 | İzin kapsamı | İzinli kullanıcı yalnızca görüntüler ve indirir. Silme ve izin yönetimi yalnızca sahibe aittir. |
| A5 | `/media/my` | Yalnızca kullanıcının kendi medyası, en yeni en üstte, sayfalı (`limit` en fazla 100). |
| A6 | 404 / 403 | Kayıt yoksa 404, erişim yoksa 403 (case gereği), bozuk id 400. |
| A7 | JPEG doğrulama | Hem `mimetype === image/jpeg` hem de dosya imzası (`FF D8 FF`). Dosya **önce bellekte doğrulanır, sonra diske yazılır**; reddedilen dosya diske hiç ulaşmaz. |
| A8 | Hata kodları | Yukarıdaki endpoint tablosunda. Hatalı login'de e-posta ya da şifrenin hangisinin yanlış olduğu söylenmez. Yanıt süresi de aynıdır, böylece kayıtlı e-postalar tahmin edilemez. |
| A9 | Saklama | `<UPLOAD_DIR>/<userId>/<uuid>.jpg`. Diskteki ad hiçbir zaman istemciden gelmez. Orijinal ad UTF-8 okunur (`fotoğraf.jpg` bozulmaz) ve temizlenir: yol parçaları, kontrol ve görünmez yön karakterleri silinir. İndirmede ad RFC 6266'ya göre kodlanır. |
| A10 | Yanıtlar | Alanlar açıkça seçilir; `passwordHash` ve dosya yolu hiçbir yanıtta yoktur. |
| A11 | İzin yönetimi | `{ userId, action: "add" \| "remove" }`. İkisi de idempotenttir; sahip kontrolü ve güncelleme tek atomik işlemdir. Sahip kendine izin veremez. |
| A12 | Silme | Önce kayıt, sonra dosya silinir. Böylece "listede görünen ama indirilemeyen" bir kayıt hiç oluşmaz. |
| A13 | Şifre | En az 8 karakter, harf ve rakam; **en fazla 72 byte** (bcrypt sınırı). bcrypt cost 10. |
| A14 | Health | Kimlik istemez, rate limit'e takılmaz; veritabanı yoksa 503. |
| A15 | Testler | Bellek içi MongoDB, gerçek veritabanına dokunmaz. |
| A16 | Rate limiting | Kimlik kontrolünden **önce** çalışır (geçersiz token'lı istekler de sayılır). IP + endpoint başına 100/dk; register, login ve refresh için 10/dk. |
| A17 | Docker | Multi-stage, `node:22-alpine`, root olmayan kullanıcı, yalnızca production paketleri, healthcheck. |
| A18 | Veritabanı | Migration ve soft delete yok; index'ler şemada tanımlı. |

**Katmanlar:** kimlik doğrulama guard'da (`JwtAuthGuard`, global), biçim doğrulama pipe'larda (`ValidationPipe`, `ParseObjectIdPipe`), dosya bazlı erişim kuralı service'te (`MediaService`). Controller'lar incedir.

---

## Güvenlik ve bilinen sınırlamalar

### Yüklenen dosyalar: zararlı içerik riski
Yükleme kontrolü **mimetype'a ve dosyanın ilk 3 byte'ına** (`FF D8 FF`) bakar. Bu, PNG'yi ya da adı değiştirilmiş başka bir dosyayı reddeder; ama **geçerli bir JPEG imzasıyla başlayan her dosyayı zararsız kılmaz.** Bu kontrolün kapsamadıkları:
- **Polyglot dosyalar:** hem geçerli JPEG hem HTML/JavaScript (ya da ZIP) olan dosyalar.
- **Sona eklenmiş içerik:** JPEG bitiş işaretinden sonra eklenmiş başka bir dosya.
- **Görüntüleyici açıkları:** dosyayı indirip açan programın açığını hedefleyen bozuk biçimli görüntüler.
- **EXIF/GPS:** fotoğraflardaki konum ve cihaz bilgisi, paylaşıldığında görünür.

**Bu projede alınmış önlemler:**
- Statik dosya servisi yok; dosyaya URL ile doğrudan ulaşılamaz.
- Diskte yalnızca UUID adlar var; dosyalar sunucuda hiçbir zaman çalıştırılmaz.
- **Sunucu görüntüyü hiç işlemez**, bu yüzden görüntü kütüphanesi açıkları sunucuyu etkilemez.
- 5 MB sınırı ve dosya bazlı erişim kontrolü.
- İndirme yanıtında `Content-Type: image/jpeg` (her zaman sabit), `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` ve `Cache-Control: private, no-store`. Tarayıcı polyglot bir dosyayı HTML olarak yorumlayamaz; açılsa bile içindeki script çalışamaz.

**Production için öneriler:**
1. **Görüntüyü yeniden kodlamak** (ör. `sharp` ile): Sona eklenmiş içeriği, polyglot kısmını ve EXIF/GPS verisini siler; dosyanın gerçekten açılabilen bir görüntü olduğunu doğrular. Çok yüksek piksel sayılı "sıkıştırma bombalarına" karşı piksel sınırı konmalı ve kütüphane güncel tutulmalıdır.
2. **Antivirüs taraması** (ör. ClamAV): Bilinen zararlıları yakalar; yeni ya da özel hazırlanmış saldırıları yakalamayabilir.

Hiçbir yöntem tek başına %100 güvence vermez; birlikte kullanılmalıdır.

### Erişim ve kimlik
- **403 / 404 ayrımı** (case gereği) bir id'nin var olup olmadığını erişimi olmayan birine de belli eder. ObjectId'ler kısmen tahmin edilebilir (içlerinde zaman bilgisi var). Daha sıkı bir yaklaşım her iki durumda da 404 döndürmek olurdu.
- **Aynı refresh token'la aynı anda iki istek** (ör. iki sekme) gelirse biri çalınma sayılır ve oturum kapanır. Rotation kullanan sistemlerde bilinen bir durumdur; istemci refresh'i tek seferde yapmalıdır.
- Kayıt işlemi kullanıcı ve oturumu transaction olmadan yazar (transaction replica set gerektirir). Oturum yazılamazsa kullanıcı oluşmuş olur ve login ile devam edebilir.

### Rate limiting
- Sayaçlar **IP + endpoint** başınadır ve **bellekte** tutulur. Uygulama birden fazla kopya halinde çalışırsa her kopya kendi sayacını tutar; ortak bir depo (ör. Redis) gerekir.
- **Aynı IP'yi paylaşan kullanıcılar** (ofis, okul ağı, mobil operatör) aynı sayacı paylaşır.
- Limit IP bazlıdır; farklı IP'lerden gelen dağıtık bir şifre denemesine karşı **hesap bazlı kilitleme yoktur.**
- `TRUST_PROXY=true` **yalnızca** API bir reverse proxy (nginx, load balancer) arkasındaysa açılmalıdır. Proxy yokken açılırsa istemci `X-Forwarded-For` başlığıyla IP'sini değiştirip limiti atlatabilir.

---

## Proje yapısı

```
src/
  main.ts, app.module.ts, app.setup.ts, swagger.ts   açılış, global guard sırası, Swagger
  config/        env şeması (Joi) ve ortak ConfigModule
  database/      bağlantı, ortak şema ayarları, seeds/ (admin seed)
  auth/          register/login/refresh/logout, JWT strategy + guard, sessions/ (rotation, TTL)
  users/         kullanıcı şeması, /users/me
  media/         upload, listeleme, erişim kuralı, indirme, izinler, storage, JPEG doğrulayıcı
  common/        decorator'lar, ParseObjectIdPipe, rate limit guard'ı, hata DTO'su
  health/        /health
test/            e2e testleri ve fixture'lar (JPEG, PNG)
Dockerfile, docker-compose.yml, .env.example
SPEC.md          tasarım kararlarının ayrıntısı · tasks/  plan ve görev listesi
```
