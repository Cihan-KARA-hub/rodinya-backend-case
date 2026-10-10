# Uygulama Planı: Medya Kütüphanesi REST API

Kaynak: [`SPEC.md`](../SPEC.md). Branch: `development`. Her görev ayrı bir commit olur (Conventional Commits).

## Bileşenler ve Bağımlılıklar

```
config + mongo + swagger + health   (iskelet)
        │
        ▼
users schema ──► auth (register/login/JWT/me) ──► refresh
                        │
                        ▼
              media upload + /my
                        │
                        ▼
     MediaAccessGuard ──► GET :id, download ──► DELETE, permissions
                        │
                        ▼
            admin seed ── throttler ── swagger denetimi
                        │
                        ▼
                docker ──► README + son doğrulama
```

## Uygulama Sırası (dikey dilimler)

Her dilim kendi testiyle uçtan uca çalışır halde biter. Bir dilim yarım kalırken bir sonrakine geçilmez.

1. **İskelet:** Nest projesi, env doğrulaması, Mongo bağlantısı, ValidationPipe, Swagger, `/health`.
2. **Kimlik:** User şeması, register/login, JWT strategy + guard, `/users/me`.
3. **Refresh:** `/auth/refresh`, token `type` ayrımı.
4. **Yükleme:** Media şeması, storage servisi, JPEG + boyut doğrulama, `/media/upload`, `/media/my`.
5. **Erişim:** `ParseObjectIdPipe`, `MediaAccessGuard`, `GET /media/:id`, `/download` (stream).
6. **Yönetim:** `DELETE /media/:id`, `GET`/`POST /media/:id/permissions`.
7. **Admin:** Guard'daki admin dalının testleri + `seed:admin` script'i.
8. **Rate limiting:** Throttler (global ve auth için ayrı limit), `/health` muaf.
9. **Swagger denetimi:** Bütün endpoint'lerde `@ApiBearerAuth`, 401/403/404/413/429 yanıtları, örnek değerler.
10. **Docker:** Dockerfile, `.dockerignore`, `docker-compose.yml`, smoke test.
11. **Teslim:** README, `.env.example` son hali, lint + coverage, son doğrulama.

## Kontrol Noktaları

- **KN-1 (1–3 sonrası):** Auth akışı e2e testlerde geçiyor ve Swagger'da "Authorize" çalışıyor.
- **KN-2 (4–6 sonrası):** Case'teki bütün medya senaryoları e2e testlerde geçiyor. Bu, projenin çekirdeğidir.
- **KN-3 (7–9 sonrası):** Ekstralar tamam, `npm run test:cov` ≥ %80 (servis ve guard'larda).
- **KN-4 (10–11 sonrası):** `docker compose up --build` ile smoke test geçiyor ve repo teslime hazır.

Her kontrol noktasında durup size özet vereceğim.

## Riskler ve Önlemler

| Risk | Etki | Önlem |
|---|---|---|
| `bcrypt` native modülü Alpine (musl) üzerinde derlenmeyebilir | Docker build kırılır | `bcrypt` 6 musl için hazır binary ile geliyor. Olmazsa `bcryptjs`'e geçilir (önce size sorulur) |
| Throttler e2e testlerinde istekleri kesebilir | Testler rastgele 429 ile kırılır | Test ortamında limitler env ile yükseltilir. 429 testi ayrı, düşük limitli bir app instance'ında çalışır |
| Upload'u doğrulamadan diske yazmak | Geçersiz dosya diskte artık bırakır | Multer `memoryStorage` kullanılır (≤ 5MB). Doğrulamadan sonra diske yazılır, DB kaydı başarısız olursa dosya silinir |
| Dosya ile DB kaydı arasında tutarsızlık (silme sırasında) | Diskte yetim dosya kalır | Önce DB kaydı silinir, sonra dosya. Dosya silme hatası loglanır, istek başarısız sayılmaz |

## Paralel / Sıralı

Tek geliştirici akışı olduğu için sıralı ilerlenecek. Docker (10) teknik olarak 1'den sonra herhangi bir zaman yapılabilir, ama `bcrypt` ve throttler kararları netleşsin diye sona bırakıldı.
