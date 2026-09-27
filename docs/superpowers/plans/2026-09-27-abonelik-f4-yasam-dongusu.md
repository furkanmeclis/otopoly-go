# Abonelik F4 — Yaşam Döngüsü, Hatırlatmalar ve Takip · Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abonelik süresi bitince ek süre → salt okunur geçişini otomatik yapmak, salt okunur modda yazma isteklerini engellemek, işletmeye ve admine hatırlatma/özet göndermek, admin'e abonelik gösterge paneli ve abonelik detay görünümü vermek, işletmeye durum bandı göstermek.

**Architecture:** `billing/usecase/lifecycle.go` saatlik worker görevinde durum geçişlerini ve hatırlatmaları yürütür; tekrar gönderimi `billing_reminder_log` benzersiz anahtarıyla engellenir. Salt okunur kontrolü `middleware.RequireOrganization` içinde (üye sorgusuna canlı abonelik durumu eklenir). Gösterge paneli ve abonelik detayı tek sorgu setiyle `billing/usecase/dashboard.go`'da.

**Tech Stack:** Go, asynq, sqlc; Next.js.

**Spec:** `docs/superpowers/specs/2026-09-27-abonelik-ve-plan-yonetimi-design.md` §0 #4, #14; §4 (salt okunur kuralı); §8; §11 (`SubscriptionBanner`). Önceki fazlar: F1–F3 planları (aynı klasör).

## Durum (kesinti durumunda buradan devam)

- [ ] Task 1 migration + sorgular
- [ ] Task 2 lifecycle (geçişler + hatırlatmalar + admin özeti) + worker
- [ ] Task 3 salt okunur middleware
- [ ] Task 4 dashboard + abonelik detayı + liste filtreleri + OpenAPI
- [ ] Task 5 frontend işletme (durum bandı + salt okunur uyarısı)
- [ ] Task 6 frontend admin gösterge paneli
- [ ] Task 7 frontend admin abonelik detayı ve filtreler
- [ ] Task 8 doğrulama, ekran görüntüleri, Notion

## Global Constraints

- F1–F3 kısıtları geçerli (same-origin, OpenAPI + `pnpm api:generate`, tutarlar string, Europe/Istanbul, commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, testler gerçek ayarları/serileri değiştirmez, fixture'lar hard delete).
- Migration `000067`.
- Geçiş kuralları (saatlik, idempotent):
  - `status ∈ {trial, active}` ve `ends_at ≤ now` → `grace`, `grace_ends_at = ends_at + grace_days` (ayarlardan; 0 ise doğrudan `read_only`). `organizations.access_ends_at = NULL` (erişim artık abonelik durumuyla yönetilir; tam kilit yok).
  - `status = grace` ve `grace_ends_at ≤ now` → `read_only`.
  - Admin `ends_at`'i geleceğe çekerse veya yeni sipariş onaylanırsa durum `active` (deneme planında `trial`), `grace_ends_at = NULL`, `access_ends_at = ends_at` — mevcut `UpdateSubscriptionAdmin` ve `approveTx` buna göre güncellenir.
- Salt okunur: canlı abonelik `read_only` iken `RequireOrganization`, `GET/HEAD/OPTIONS` dışındaki istekleri `403 SUBSCRIPTION_READ_ONLY` ile keser; muaf yollar `/v1/tenant/billing/`, `/v1/tenant/exports/`. Deneme süresi dolmuş işletmeler de bu yola girer (artık `ORGANIZATION_ACCESS_EXPIRED` ile tamamen kilitlenmez).
- Hatırlatmalar (işletme sahiplerine, uygulama içi + e-posta; mevcut notifications/notifycenter altyapısı): `ends_in_{d}` (`reminder_days`, varsayılan 7/3/1), `ended` (grace başlangıcı), `read_only`, `order_expiring` (açık siparişin `expires_at`'ine ≤ 24 saat). Anahtar: `{subscription_uuid|order_uuid}:{kind}` → `billing_reminder_log` (`UNIQUE(key)`); aynı anahtar ikinci kez gönderilmez.
- Admin özeti: günde bir (06:00 İstanbul) `platform.billing.write` sahiplerine uygulama içi: bekleyen ödeme sayısı, 7 gün içinde bitecek, ek sürede, salt okunura düşen. Anahtar `digest:{YYYY-MM-DD}`.
- Metinler TR; bildirim bağlantıları: işletme `/t/{slug}/settings/billing`, admin `/platform/billing`.

## Review Focus

1. **Çift gönderim:** worker aynı saat içinde iki kez çalışırsa hatırlatma tek gider. Task 2 DB testi.
2. **Salt okunurda okuma serbest, fatura/ödeme açık:** `GET /v1/tenant/jobs` 200, `POST /v1/tenant/jobs` 403, `POST /v1/tenant/billing/orders` 201. Task 3 testi.
3. **Salt okunurdan çıkış:** yeni sipariş onayı → `active`, yazma tekrar serbest. Task 2/3 DB testi.
4. **grace_days = 0:** doğrudan `read_only`. Task 2 testi.
5. **Deneme bitişi:** deneme `ends_at` geçmiş işletme `grace`'e, sonra `read_only`'ye düşer; tamamen kilitlenmez. Task 2 testi.

---

## API sözleşmesi

```jsonc
// BillingDashboard  GET /v1/platform/billing/dashboard  (platform.billing.read)
{ "counts": { "trial": 12, "active": 40, "grace": 3, "read_only": 5 },
  "plans": [ { "code": "pro", "name": "Pro", "count": 30 } ],
  "approved_this_month": { "count": 8, "amount": "92400.00" },
  "orders": { "pending_payment": 2, "payment_reported": 1 },
  "expiring": { "within_7": 4, "within_30": 11 },
  "trial_conversion": { "trials_90d": 20, "converted_90d": 6, "rate": 30.0 },
  "discounts": [ { "code": "YAZ10", "uses": 3, "discount_total": "4860.00", "revenue": "43740.00" } ] }

// AdminSubscriptionDetail  GET /v1/platform/billing/subscriptions/{uuid}/detail
{ "subscription": AdminSubscription,           // + "grace_ends_at": string|null
  "history": [AdminSubscription],              // aynı işletmenin önceki abonelikleri (yeni → eski)
  "orders": [BillingOrder], "invoices": [BillingInvoice], "meters": [BillingUsageMeter] }
```

- `AdminSubscription`'a `grace_ends_at: string|null` eklenir.
- `GET /v1/platform/billing/subscriptions` yeni sorgular: `plan_uuid`, `expiring_within_days` (ör. 7; yalnız `trial|active` ve `ends_at` o aralıkta).
- `BillingSubscription` (tenant overview) zaten `grace_ends_at` içerir; overview'a `read_only: boolean` eklenir.
- Hata kodu `SUBSCRIPTION_READ_ONLY` (403).

---

### Task 1: Migration 000067 + sorgular
- `billing_reminder_log (id BIGSERIAL, key VARCHAR(120) UNIQUE, kind VARCHAR(40), organization_id BIGINT NULL FK CASCADE, sent_at TIMESTAMPTZ DEFAULT NOW())`.
- Sorgular (`queries/billing_lifecycle.sql`): `ListSubscriptionsToGrace`, `ListSubscriptionsToReadOnly`, `MoveToGrace`, `MoveToReadOnly`, `ClearOrganizationAccessEnd`, `ListSubscriptionsEndingOn` (İstanbul günü aralığı), `ListOrdersExpiringWithin`, `InsertReminderLog :execrows` (`ON CONFLICT DO NOTHING`; 0 → zaten gönderilmiş), dashboard toplamları, `ListSubscriptionHistoryForOrg`, `ListOrdersForOrgAdmin`, `ListInvoicesForOrgAdmin`, liste filtreleri için `ListSubscriptionsAdmin` genişletmesi.
- Üye sorgusu (`GetOrganizationMemberByUserAndOrgUUID`) canlı abonelik durumunu da döner (`LEFT JOIN billing_subscriptions … status IN (trial,active,grace,read_only)` → `subscription_status`).

### Task 2: Lifecycle + worker
- `lifecycle.go`: `RunLifecycle(ctx, now) (LifecycleResult, error)` (geçişler → hatırlatmalar), `SendAdminDigest(ctx, now)`. Notifier arayüzüne e-posta seçeneği (mevcut notifications servisinin e-posta kanalı).
- `UpdateSubscriptionAdmin` ve `approveTx`: geleceğe uzatınca durum/erişim düzeltmesi (Global Constraints).
- Worker: `app:billing:lifecycle` saatlik (`5 * * * *`), `app:billing:digest` `0 3 * * *` (UTC = 06:00 İstanbul); açılışta bir kez lifecycle.
- DB testleri: Review Focus 1, 3, 4, 5 + reminder_days tetiklenmesi (`ends_at = now + 3 gün` → `ends_in_3` bir kez).

### Task 3: Salt okunur middleware
- `RequireOrganization`: `subscription_status == "read_only"` + yazma metodu + muaf olmayan yol → `403 SUBSCRIPTION_READ_ONLY`. `orgAccessAllowed` davranışı `access_ends_at = NULL` için zaten "süresiz"dir; değişmez.
- `pkg/response`: `CodeSubscriptionReadOnly`.
- Test: `middleware` birim testi (fake querier) + Review Focus 2.

### Task 4: Dashboard, detay, filtreler, OpenAPI
- `dashboard.go`: `Dashboard(ctx)`, `SubscriptionDetail(ctx, uuid)`; liste filtreleri.
- Handler/route + OpenAPI (`BillingDashboard`, `BillingAdminSubscriptionDetail`, `grace_ends_at`, `read_only`, yeni query parametreleri; 401/403 yanıtları). `make openapi-lint` temiz.

### Task 5: Frontend işletme
- `SubscriptionBanner` (tenant layout'ta, `AppLayout` içinde üstte): deneme/aktif ve ≤7 gün kaldı (amber), `grace` (kırmızı; "Ek süre: X gün"), `read_only` (kırmızı; "Salt okunur mod — yeni kayıt açılamaz"), açık sipariş `payment_reported` (mavi). Hepsi "Aboneliğe git" bağlantılı; kapatılabilir (oturumluk `sessionStorage`, try/catch).
- `SUBSCRIPTION_READ_ONLY` → limit olay sistemiyle aynı diyalog (başlık "Salt okunur mod"), toast yok.

### Task 6: Frontend admin gösterge paneli
- `/platform/billing` sayfası: durum sayaçları, bu ay onaylanan tutar/adet, bekleyen ödemeler (Ödemeler'e bağlantı), 7/30 gün içinde bitecek (Abonelikler filtresine bağlantı), deneme → ücretli dönüşüm oranı, plan dağılımı (yatay çubuklar), indirim kodu özet tablosu. Nav: "Gösterge paneli" ilk öğe.

### Task 7: Frontend admin abonelik detayı
- Abonelikler: plan filtresi, "7 gün içinde bitecek" hızlı filtresi, `grace_ends_at` gösterimi; satır tıklayınca detay sheet (abonelik özeti, geçmiş, siparişler, faturalar, kullanım sayaçları) + "Süre uzat / düzenle" ("salt okunuru kaldır" = bitişi geleceğe çekmek, sheet'te açıklama).

### Task 8: Doğrulama
- `go test ./...` (DB), lint, tsc/eslint; tarayıcı: techoto aboneliğini SQL ile geçmişe çek → lifecycle çalıştır → grace bandı → read_only bandı + iş açma 403 diyalog → admin uzat → normal. Gösterge paneli + detay ekran görüntüleri; Notion F4 bölümü (araç/yazar notu yok). Push.
