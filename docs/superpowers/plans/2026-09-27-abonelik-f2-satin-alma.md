# Abonelik F2 — Satın Alma · Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** İşletme bir plan ve dönem seçip (indirim kodu, kıst hesap ve alacak bakiyesi uygulanmış) sipariş açar, havale bilgilerini alır, dekont yükleyerek ödemeyi bildirir; admin ödemeyi onaylar/reddeder, elle abonelik tanımlar/uzatır, indirim kodlarını ve ödeme ayarlarını yönetir.

**Architecture:** F1'deki `modules/billing` genişler. Saf fiyat hesabı `modules/billing/pricing` paketinde (DB'siz, tablo testli). Ödeme kanalı `Channel` arayüzü arkasında; tek uygulama `bank_transfer`. Onay tek transaction'da eski canlı aboneliği kapatır, yenisini açar, `organizations.plan_code/access_*` alanlarını senkronlar, indirim kullanımını ve alacak bakiyesini yazar. Süresi dolan siparişleri worker kapatır. Dekont storage driver'a `billing/receipts/{org_uuid}/{order_uuid}/…` anahtarıyla yazılır ve yalnızca API üzerinden stream edilir.

**Tech Stack:** Go 1.26, pgx v5, sqlc, asynq; Next.js 15, TanStack Query, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-27-abonelik-ve-plan-yonetimi-design.md` (§0 kararlar #1, #2, #5, #8, #12, #14; §3 `billing_orders`, `billing_discount_codes`, `billing_discount_uses`, `billing_settings`; §5; §6; §10; §11; §12). Önceki faz: `docs/superpowers/plans/2026-09-27-abonelik-f1-plan-ve-yetkilendirme.md`.

## Global Constraints

- Browser yalnızca same-origin `/api/v1/*`; dekont URL'si API'ye aittir (`…/orders/{uuid}/receipt`), tarayıcıda storage anahtarı birleştirilmez.
- Yeni `/v1` route'ları aynı değişiklikte `backend/docs/openapi.yaml`'a; sonra `cd frontend && pnpm api:generate`. `make -C backend openapi-lint` geçmeli.
- Migration numarası `000065`. Sorgular `backend/internal/database/queries/billing_orders.sql` → `sqlc generate`.
- İzinler F1'de mevcut: `tenant.billing.read` (tüm üyeler), `tenant.billing.write` (owner), `platform.billing.read|write|settings`. Yeni izin yok.
- Para: TRY, fiyatlar KDV **dahil**; tutarlar `numeric(18,2)`, JSON'da string (`"1500.00"`). Hesaplar `math/big.Rat`, yuvarlama 2 hane, yarım yukarı.
- KDV: `vat_amount = total − total / (1 + vat_rate/100)`; `vat_rate` ayarlardan (varsayılan 20).
- Dönem uzunluğu Europe/Istanbul takvimiyle: aylık `AddDate(0,1,0)`, yıllık `AddDate(1,0,0)`.
- Sipariş bekleme süresi `order_ttl_days` (varsayılan **3**), ek süre `grace_days` (varsayılan 3, F4 kullanır).
- Referans kodu: `OTO-` + 6 karakter, alfabe `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (0/O/1/I yok), benzersiz.
- Bir işletmede aynı anda tek açık sipariş (`pending_payment` | `payment_reported`); ikincisi `409 ORDER_OPEN` (details `order_uuid`).
- Dekont: en fazla 10 MB; `application/pdf`, `image/jpeg`, `image/png`, `image/webp`.
- Hata kodları (yeni): `ORDER_OPEN` (409), `DISCOUNT_INVALID` (422, details `reason` ∈ `not_found|inactive|not_started|expired|plan|period|max_uses|max_uses_per_org|first_purchase_only`), `ORDER_STATE` (409, yanlış durumda işlem), `PLAN_UNAVAILABLE` (409, plan silinmiş/pasif).
- Metinler `frontend/src/locales/{tr,en}/billing.json`; tarih alanları `.agents/skills/admin-date-picker/SKILL.md`'ye uyar.
- Commit sonu: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `main` üzerinde çalışılır, her görev sonunda commit.

## Review Focus

1. **Kıst kredisi yeni fiyattan büyük (düşürme):** yıllık Pro'dan aylık Başlangıç'a geçişte kredi 9.000 TL, yeni fiyat 500 TL → `total = 0`, fazlalık 8.500 TL onayda `credit_balance`'a yazılmalı, sipariş ödeme beklemeden onaylanmalı. Task 2 `TestQuoteDowngradeSurplus` + Task 5 DB testi.
2. **Deneme aboneliğinden ilk satın alma:** deneme `price_paid = 0` → kıst kredisi 0; `kind = new`; başlangıç şimdi. Task 2 `TestQuoteFromTrial`.
3. **Aynı plan yenileme süresi yutmamalı:** aktif aboneliği 10 gün kalmış işletme aynı planı yenilerse yeni dönem eski bitişten başlar (kıst yok). Task 2 `TestQuoteRenewStartsAtOldEnd`.
4. **İndirim kodu sınırı onay anında aşılmış:** iki bekleyen siparişte aynı `max_uses = 1` kodu → ilk onay geçer, ikinci onay `422 DISCOUNT_INVALID` döner, sipariş açık kalır (admin reddedebilir). Task 5 DB testi.
5. **Süresi dolan siparişe dekont:** `expires_at` geçmiş siparişe `report` → `409 ORDER_STATE`; worker `expired` yapar. Task 4 DB testi.

---

## API sözleşmesi (backend ↔ frontend ortak)

Tüm cevaplar standart zarf (`{success, data, meta}`); listeler `{items, total, limit, offset}`.

```jsonc
// QuoteLine
{ "kind": "plan" | "proration" | "discount" | "credit", "label": "Pro (Yıllık)", "amount": "-812.50" }

// OrderPreview  (POST /v1/tenant/billing/orders/preview)
{
  "kind": "new" | "renew" | "upgrade" | "downgrade" | "period_change",
  "plan": { "uuid": "…", "code": "pro", "name": "Pro" },
  "period": "monthly" | "yearly",
  "list_price": "16200.00",
  "proration_credit": "812.50",
  "discount_code": "YAZ10" | null,
  "discount_amount": "1538.75",
  "credit_applied": "0.00",
  "credit_surplus": "0.00",          // düşürmede sonraki döneme kalan
  "total": "13848.75",
  "vat_rate": 20,
  "vat_amount": "2308.13",
  "starts_at": "2026-09-27T…", "ends_at": "2027-09-27T…",
  "lines": [QuoteLine],
  "discount_error": null | { "reason": "expired", "message": "Kodun süresi dolmuş." }
}

// BankInstructions
{ "bank_name": "…", "account_holder": "…", "iban": "TR…", "amount": "13848.75", "reference_code": "OTO-7F3K2Q", "payment_instructions": "…" }

// Order
{
  "uuid": "…", "reference_code": "OTO-7F3K2Q",
  "kind": "upgrade", "status": "pending_payment" | "payment_reported" | "approved" | "rejected" | "cancelled" | "expired",
  "channel": "bank_transfer",
  "plan": { "uuid", "code", "name" }, "period": "yearly",
  "list_price", "proration_credit", "discount_code", "discount_amount", "credit_applied", "credit_surplus", "total", "vat_amount",
  "lines": [QuoteLine],
  "has_receipt": true, "receipt_content_type": "application/pdf" | null, "report_note": "",
  "reported_at": null, "reviewed_at": null, "reject_reason": "",
  "expires_at": "…", "created_at": "…",
  "instructions": BankInstructions | null,           // yalnızca pending_payment / payment_reported
  "organization": { "uuid", "slug", "name" } | null // yalnızca platform uçlarında
}

// DiscountCode
{ "uuid", "code": "YAZ10", "kind": "percent" | "amount", "value": "10.00",
  "plan_uuids": [], "periods": [], "starts_at": null, "ends_at": null,
  "max_uses": null, "max_uses_per_org": null, "first_purchase_only": false,
  "is_active": true, "note": "", "used_count": 3, "created_at": "…" }

// AdminSubscription
{ "uuid", "organization": { "uuid", "slug", "name" }, "plan": { "uuid", "code", "name" },
  "period", "status", "starts_at", "ends_at", "days_left", "price_paid", "credit_balance", "source", "note", "created_at" }

// PaymentSettings  (billing_settings satırının F2 alanları)
{ "bank_name", "account_holder", "iban", "payment_instructions", "order_ttl_days": 3, "grace_days": 3, "vat_rate": 20 }
```

**Tenant** (`read` = `tenant.billing.read`, `write` = `tenant.billing.write`):

| Metot | Yol | İzin | Gövde / sorgu | Cevap |
|---|---|---|---|---|
| POST | `/v1/tenant/billing/orders/preview` | read | `{plan_uuid, period, discount_code?}` | `OrderPreview` |
| POST | `/v1/tenant/billing/orders` | write | `{plan_uuid, period, discount_code?}` | `201 Order` · `409 ORDER_OPEN` · `422 DISCOUNT_INVALID` · `409 PLAN_UNAVAILABLE` |
| GET | `/v1/tenant/billing/orders` | read | `?status=open|all&limit&offset` | liste `Order` |
| GET | `/v1/tenant/billing/orders/{uuid}` | read | | `Order` |
| POST | `/v1/tenant/billing/orders/{uuid}/report` | write | multipart `file` (zorunlu), `note` | `Order` · `409 ORDER_STATE` |
| POST | `/v1/tenant/billing/orders/{uuid}/cancel` | write | | `Order` · `409 ORDER_STATE` |
| GET | `/v1/tenant/billing/orders/{uuid}/receipt` | read | | dosya stream |

Tenant `overview` cevabına `open_order: Order | null` alanı eklenir.

**Platform:**

| Metot | Yol | İzin | Gövde / sorgu | Cevap |
|---|---|---|---|---|
| GET | `/v1/platform/billing/orders` | read | `?status=&q=&limit&offset` (`q`: işletme adı/slug/referans) | liste `Order` |
| GET | `/v1/platform/billing/orders/summary` | read | | `{pending_payment, payment_reported}` |
| GET | `/v1/platform/billing/orders/{uuid}` | read | | `Order` |
| GET | `/v1/platform/billing/orders/{uuid}/receipt` | read | | dosya stream |
| POST | `/v1/platform/billing/orders/{uuid}/approve` | write | `{note?}` | `Order` · `409 ORDER_STATE` · `409 PLAN_UNAVAILABLE` · `422 DISCOUNT_INVALID` |
| POST | `/v1/platform/billing/orders/{uuid}/reject` | write | `{reason}` (zorunlu) | `Order` |
| GET | `/v1/platform/billing/subscriptions` | read | `?status=&q=&limit&offset` | liste `AdminSubscription` |
| POST | `/v1/platform/billing/subscriptions` | write | `{organization_uuid, plan_uuid, period, starts_at, ends_at, price_paid, note}` | `201 AdminSubscription` |
| PATCH | `/v1/platform/billing/subscriptions/{uuid}` | write | `{ends_at?, plan_uuid?, note?}` | `AdminSubscription` |
| GET/POST | `/v1/platform/billing/discount-codes` | read/write | liste `?q=&limit&offset` / gövde | `DiscountCode` |
| GET/PUT/DELETE | `/v1/platform/billing/discount-codes/{uuid}` | read/write | | `DiscountCode` (DELETE = pasifleştir; kullanılmışsa silinmez) |
| GET/PUT | `/v1/platform/billing/settings` | read/settings | `PaymentSettings` | `PaymentSettings` |

---

## Dosya haritası

**Backend**
- `backend/migrations/000065_billing_orders.{up,down}.sql`
- `backend/internal/database/queries/billing_orders.sql`
- `backend/internal/modules/billing/pricing/{pricing.go,pricing_test.go}` — saf hesap
- `backend/internal/modules/billing/usecase/{discounts.go,settings.go,channels.go,orders.go,approve.go,admin_subscriptions.go,refcode.go,orders_db_test.go}`
- `backend/internal/modules/billing/handler/{orders.go,platform_orders.go,discounts.go,settings.go}`
- `backend/internal/modules/billing/routes.go`, `backend/internal/queue/billing_orders.go`, `backend/cmd/worker/main.go`, `backend/internal/httpserver/server.go`, `backend/docs/openapi.yaml`

**Frontend**
- `frontend/src/features/billing/{types.ts,services/billing.service.ts,hooks/use-billing.ts}` (genişler)
- `frontend/src/features/billing/components/{checkout-dialog.tsx,order-status-card.tsx,bank-instructions.tsx,report-payment-dialog.tsx,orders-history.tsx}`
- `frontend/src/features/platform-billing/components/{payments-page.tsx,payment-detail-sheet.tsx,subscriptions-page.tsx,subscription-dialog.tsx,discount-codes-page.tsx,discount-code-dialog.tsx,settings-page.tsx}`, `nav/index.tsx`
- `frontend/src/app/(platform)/platform/billing/{payments,subscriptions,discount-codes,settings}/page.tsx`
- `frontend/src/config/{routes.ts,nav.ts}`, `frontend/src/locales/{tr,en}/billing.json`

---

### Task 1: Migration 000065 + sqlc sorguları

**Files:** Create `backend/migrations/000065_billing_orders.up.sql`, `.down.sql`, `backend/internal/database/queries/billing_orders.sql`.

**Interfaces — Produces:** tablolar `billing_orders`, `billing_discount_codes`, `billing_discount_uses`, `billing_settings` (singleton `id = 1`, tüm spec §3 sütunları; F3/F4 alanları dahil ki sonraki fazlar ALTER etmesin); sqlc sorguları aşağıda.

- [ ] **Step 1: Up migration**

```sql
-- Purchases (spec §3, §5, §6): orders, discount codes and their uses, and
-- the platform billing settings singleton (F3/F4 columns created now).

CREATE TABLE billing_settings (
    id                   SMALLINT     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    seller_name          VARCHAR(255) NOT NULL DEFAULT '',
    seller_tax_id        VARCHAR(20)  NOT NULL DEFAULT '',
    seller_tax_office    VARCHAR(120) NOT NULL DEFAULT '',
    seller_address       TEXT         NOT NULL DEFAULT '',
    seller_city          VARCHAR(80)  NOT NULL DEFAULT '',
    seller_email         VARCHAR(255) NOT NULL DEFAULT '',
    seller_phone         VARCHAR(40)  NOT NULL DEFAULT '',
    seller_website       VARCHAR(255) NOT NULL DEFAULT '',
    bank_name            VARCHAR(120) NOT NULL DEFAULT '',
    account_holder       VARCHAR(255) NOT NULL DEFAULT '',
    iban                 VARCHAR(34)  NOT NULL DEFAULT '',
    payment_instructions TEXT         NOT NULL DEFAULT '',
    order_ttl_days       INT          NOT NULL DEFAULT 3 CHECK (order_ttl_days BETWEEN 1 AND 30),
    grace_days           INT          NOT NULL DEFAULT 3 CHECK (grace_days BETWEEN 0 AND 30),
    vat_rate             INT          NOT NULL DEFAULT 20 CHECK (vat_rate BETWEEN 0 AND 100),
    invoice_series       VARCHAR(3)   NOT NULL DEFAULT 'TWD',
    xslt_object_key      TEXT         NOT NULL DEFAULT '',
    reminder_days        INT[]        NOT NULL DEFAULT '{7,3,1}',
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
INSERT INTO billing_settings (id) VALUES (1);
CREATE TRIGGER trg_billing_settings_set_updated_at BEFORE UPDATE ON billing_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_discount_codes (
    id                  BIGSERIAL      PRIMARY KEY,
    uuid                UUID           NOT NULL DEFAULT gen_random_uuid(),
    code                VARCHAR(40)    NOT NULL,
    kind                VARCHAR(8)     NOT NULL,          -- percent | amount
    value               NUMERIC(18, 2) NOT NULL,
    applies_to_plans    BIGINT[]       NOT NULL DEFAULT '{}',
    applies_to_periods  TEXT[]         NOT NULL DEFAULT '{}',
    starts_at           TIMESTAMPTZ    NULL,
    ends_at             TIMESTAMPTZ    NULL,
    max_uses            INT            NULL,
    max_uses_per_org    INT            NULL,
    first_purchase_only BOOLEAN        NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN        NOT NULL DEFAULT TRUE,
    note                TEXT           NOT NULL DEFAULT '',
    created_by          BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_discount_codes_uuid UNIQUE (uuid),
    CONSTRAINT uq_billing_discount_codes_code UNIQUE (code),
    CONSTRAINT chk_billing_discount_codes_kind CHECK (kind IN ('percent', 'amount')),
    CONSTRAINT chk_billing_discount_codes_value CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
    CONSTRAINT chk_billing_discount_codes_upper CHECK (code = UPPER(code))
);
CREATE TRIGGER trg_billing_discount_codes_set_updated_at BEFORE UPDATE ON billing_discount_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_orders (
    id                 BIGSERIAL      PRIMARY KEY,
    uuid               UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id    BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    plan_id            BIGINT         NOT NULL REFERENCES billing_plans (id),
    period             VARCHAR(8)     NOT NULL,
    kind               VARCHAR(16)    NOT NULL,
    status             VARCHAR(20)    NOT NULL DEFAULT 'pending_payment',
    channel            VARCHAR(20)    NOT NULL DEFAULT 'bank_transfer',
    reference_code     VARCHAR(16)    NOT NULL,
    list_price         NUMERIC(18, 2) NOT NULL,
    proration_credit   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_code_id   BIGINT         NULL REFERENCES billing_discount_codes (id) ON DELETE SET NULL,
    discount_code      VARCHAR(40)    NOT NULL DEFAULT '',
    discount_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit_applied     NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit_surplus     NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total              NUMERIC(18, 2) NOT NULL,
    vat_rate           INT            NOT NULL,
    vat_amount         NUMERIC(18, 2) NOT NULL,
    lines              JSONB          NOT NULL DEFAULT '[]'::jsonb,
    starts_at          TIMESTAMPTZ    NOT NULL,
    ends_at            TIMESTAMPTZ    NOT NULL,
    receipt_object_key TEXT           NOT NULL DEFAULT '',
    receipt_content_type VARCHAR(80)  NOT NULL DEFAULT '',
    report_note        TEXT           NOT NULL DEFAULT '',
    reported_at        TIMESTAMPTZ    NULL,
    reviewed_by        BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    reviewed_at        TIMESTAMPTZ    NULL,
    review_note        TEXT           NOT NULL DEFAULT '',
    reject_reason      TEXT           NOT NULL DEFAULT '',
    subscription_id    BIGINT         NULL REFERENCES billing_subscriptions (id) ON DELETE SET NULL,
    custom_features    JSONB          NOT NULL DEFAULT '{}'::jsonb,
    expires_at         TIMESTAMPTZ    NOT NULL,
    created_by         BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_orders_uuid UNIQUE (uuid),
    CONSTRAINT uq_billing_orders_reference UNIQUE (reference_code),
    CONSTRAINT chk_billing_orders_period CHECK (period IN ('monthly', 'yearly')),
    CONSTRAINT chk_billing_orders_kind CHECK (kind IN ('new', 'renew', 'upgrade', 'downgrade', 'period_change')),
    CONSTRAINT chk_billing_orders_status CHECK (status IN ('pending_payment', 'payment_reported', 'approved', 'rejected', 'cancelled', 'expired'))
);
-- One open order per organization (spec §12).
CREATE UNIQUE INDEX uq_billing_orders_open ON billing_orders (organization_id)
    WHERE status IN ('pending_payment', 'payment_reported');
CREATE INDEX idx_billing_orders_status ON billing_orders (status, created_at DESC);
CREATE INDEX idx_billing_orders_expires ON billing_orders (expires_at) WHERE status = 'pending_payment';
CREATE TRIGGER trg_billing_orders_set_updated_at BEFORE UPDATE ON billing_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_discount_uses (
    id               BIGSERIAL      PRIMARY KEY,
    discount_code_id BIGINT         NOT NULL REFERENCES billing_discount_codes (id) ON DELETE CASCADE,
    organization_id  BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    order_id         BIGINT         NOT NULL REFERENCES billing_orders (id) ON DELETE CASCADE,
    amount           NUMERIC(18, 2) NOT NULL,
    used_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_discount_uses_order UNIQUE (order_id)
);
CREATE INDEX idx_billing_discount_uses_code ON billing_discount_uses (discount_code_id, organization_id);
```

- [ ] **Step 2: Down migration** — dört tabloyu ters sırada `DROP TABLE IF EXISTS` (`billing_discount_uses`, `billing_orders`, `billing_discount_codes`, `billing_settings`).

- [ ] **Step 3: `billing_orders.sql`** — en az şu sorgular (isimler sabit; alan listesi uygulayana bırakılır, sqlc derlemeli):
  - Ayarlar: `GetBillingSettings :one`, `UpdatePaymentSettings :one` (bank_name, account_holder, iban, payment_instructions, order_ttl_days, grace_days, vat_rate).
  - İndirim: `ListDiscountCodes :many` (`q` ILIKE code/note, limit/offset, `used_count` alt sorgusu), `CountDiscountCodes :one`, `GetDiscountCodeByUUID :one`, `GetDiscountCodeByCode :one`, `CreateDiscountCode :one`, `UpdateDiscountCode :one`, `DeactivateDiscountCode :exec`, `DeleteUnusedDiscountCode :execrows` (kullanımı yoksa siler), `CountDiscountUses :one`, `CountDiscountUsesByOrg :one`, `InsertDiscountUse :exec`.
  - Sipariş: `CreateOrder :one`, `GetOrderByUUIDForOrg :one` (+ plan code/name/uuid join), `GetOrderByUUID :one` (+ organization uuid/slug/name join), `GetOrderForUpdate :one` (`FOR UPDATE`), `GetOpenOrderForOrg :one`, `ListOrdersForOrg :many` + `CountOrdersForOrg :one` (`status` filtresi: `open` = iki açık durum, boş = hepsi), `ListOrders :many` + `CountOrders :one` (platform; `status`, `q` işletme adı/slug/referans ILIKE), `OrderStatusSummary :one` (`pending_payment`, `payment_reported` sayıları), `ReportOrder :one`, `SetOrderStatus :one` (status, reviewed_by, reviewed_at, review_note, reject_reason, subscription_id), `ExpireDueOrders :many` (`pending_payment` ve `expires_at < NOW()` → `expired`, `RETURNING id, organization_id`), `ReferenceCodeExists :one`, `CountApprovedOrdersForOrg :one` (ilk satın alma kontrolü).
  - Abonelik (F1 sorgularına ek): `ListSubscriptionsAdmin :many` + `CountSubscriptionsAdmin :one` (`status`, `q`; yalnızca canlı + son iptal edilenler değil — **her işletmenin en güncel satırı**: `DISTINCT ON (organization_id) … ORDER BY organization_id, created_at DESC` alt sorgu), `GetSubscriptionByUUID :one`, `GetLiveSubscriptionForUpdate :one` (`FOR UPDATE`), `CloseSubscription :exec` (status `cancelled`, note ek), `UpdateSubscriptionAdmin :one` (ends_at, plan_id, note), `SetSubscriptionCredit :exec`.
  - `CreateSubscription` F1'de var; `credit_balance` parametresi yoksa `CreateSubscriptionWithCredit :one` ekle.

- [ ] **Step 4: Uygula + doğrula** — `make -C backend migrate-up`, `cd backend && sqlc generate && go build ./...`, `make -C backend migrate-down && make -C backend migrate-up`.

- [ ] **Step 5: Commit** — `feat(billing): orders, discount codes and billing settings schema`.

---

### Task 2: Saf fiyat hesabı (`pricing` paketi)

**Files:** Create `backend/internal/modules/billing/pricing/pricing.go`, `pricing_test.go`.

**Interfaces — Produces:**

```go
package pricing

type Money = *big.Rat // helpers: Parse(string) (Money, error), Format(Money) string ("1234.50"), Round2

type Current struct {        // canlı abonelik; yoksa nil
    PlanID     int64
    PlanRank   string        // monthly-equivalent price (string) — upgrade/downgrade kıyaslaması
    Period     string        // monthly | yearly
    Status     string        // trial | active | grace | read_only
    StartsAt, EndsAt time.Time
    PricePaid  string
    CreditBalance string
}
type Target struct {
    PlanID    int64
    PlanName  string
    PlanRank  string        // hedef planın aylık eşdeğeri
    Period    string
    ListPrice string        // dönem fiyatı (yıllık için YearlyPrice sonucu)
}
type Discount struct { Code, Kind, Value string } // Kind percent|amount; nil = yok
type Input struct {
    Now      time.Time
    Loc      *time.Location
    Current  *Current
    Target   Target
    Discount *Discount
    VATRate  int
    Labels   Labels // TR metinler: Plan "%s (%s)", Proration "Kıst iadesi (%s, %d gün)", Discount "İndirim kodu %s", Credit "Alacak bakiyesi"
}
type Line struct { Kind, Label, Amount string }
type Quote struct {
    Kind            string // new | renew | upgrade | downgrade | period_change
    StartsAt, EndsAt time.Time
    ListPrice, ProrationCredit, DiscountAmount, CreditApplied, CreditSurplus, Total, VATAmount string
    Lines           []Line
}
func Compute(in Input) (Quote, error)
func PeriodEnd(start time.Time, period string, loc *time.Location) time.Time
```

Kurallar (spec §5 #3–#6):
1. `kind`: `Current == nil` veya `Status == "trial"` → `new`. Aynı plan + aynı dönem → `renew`. Aynı plan, farklı dönem → `period_change`. Farklı plan: hedef `PlanRank` > mevcut → `upgrade`, değilse `downgrade`.
2. Başlangıç: `renew` ise `max(now, Current.EndsAt)`; diğerleri `now`. Bitiş `PeriodEnd(start, period)`.
3. Kıst kredisi yalnızca `kind ∉ {new, renew}` ve `Status ∈ {active, grace}` ve `PricePaid > 0`: `PricePaid × clamp((EndsAt − now) / (EndsAt − StartsAt), 0, 1)`, 2 haneye yuvarla. Kalan gün etiketi `ceil(remaining / 24h)`.
4. `base = max(0, ListPrice − ProrationCredit)`; `surplusFromProration = max(0, ProrationCredit − ListPrice)`.
5. İndirim `base` üzerinden: percent → `base × v / 100`; amount → `min(v, base)`. `afterDiscount = base − discount`.
6. `CreditApplied = min(Current.CreditBalance, afterDiscount)`; `Total = afterDiscount − CreditApplied`.
7. `CreditSurplus = surplusFromProration + (CreditBalance − CreditApplied)` — onayda yeni aboneliğin `credit_balance`'ı olur.
8. `VATAmount = Total − Total / (1 + VATRate/100)`.
9. Satırlar (sıfır olanlar yazılmaz; indirim ve krediler negatif): `plan` (+ListPrice), `proration` (−min(ProrationCredit, ListPrice)), `discount`, `credit`.

- [ ] **Step 1: Tablo testlerini yaz** (`pricing_test.go`) — en az:

```go
func TestQuoteFromTrial(t *testing.T)            // trial → new, credit 0, total = list, starts now
func TestQuoteRenewStartsAtOldEnd(t *testing.T)  // active monthly Pro, 10 days left → renew, StartsAt = old EndsAt, no proration
func TestQuoteUpgradeProration(t *testing.T)     // monthly 1000 paid, half period left → credit 500.00; yearly target 10800 → total 10300.00, VAT 1716.67 (rate 20)
func TestQuoteDowngradeSurplus(t *testing.T)     // yearly 9000 paid, full year left, monthly 500 target → total 0, CreditSurplus 8500.00, lines: plan +500, proration −500
func TestQuoteDiscountPercentAfterProration(t *testing.T) // base 1000, 10% → discount 100.00, total 900.00
func TestQuoteDiscountAmountCapped(t *testing.T) // amount 5000 on base 1000 → discount 1000.00, total 0
func TestQuoteCreditBalanceApplied(t *testing.T) // balance 300, afterDiscount 1000 → applied 300, total 700, surplus 0
func TestPeriodEndIstanbul(t *testing.T)         // 2026-01-31 monthly → 2026-03-03 (Go AddDate normalisation) documented; yearly 2028-02-29 → 2029-03-01
func TestVATRounding(t *testing.T)               // total 100.00 → vat 16.67
```
Her test beklenen `Format` çıktılarını string olarak karşılaştırır.

- [ ] **Step 2: FAIL gör** — `cd backend && go test ./internal/modules/billing/pricing/` → `undefined: Compute`.
- [ ] **Step 3: Uygula** (`math/big.Rat`, yarım-yukarı `Round2`: `(x*100 + 1/2) floor / 100` pozitif sayılar için).
- [ ] **Step 4: PASS** — `go test ./internal/modules/billing/pricing/ -v`.
- [ ] **Step 5: Commit** — `feat(billing): pricing engine for proration, discounts, credit and VAT`.

---

### Task 3: İndirim kodları, ödeme ayarları, referans kodu

**Files:** Create `usecase/discounts.go`, `usecase/settings.go`, `usecase/refcode.go`, `usecase/discounts_test.go`.

**Interfaces — Produces:**
```go
type DiscountCode struct{ /* JSON = API sözleşmesi DiscountCode */ }
type DiscountInput struct { Code, Kind, Value string; PlanUUIDs []uuid.UUID; Periods []string; StartsAt, EndsAt *time.Time; MaxUses, MaxUsesPerOrg *int32; FirstPurchaseOnly, IsActive bool; Note string }
type DiscountError struct{ Reason, Message string } // error; errors.Is(err, ErrDiscountInvalid)
var ErrDiscountInvalid = errors.New("discount invalid")
func (s *Service) ListDiscountCodes(ctx, q string, limit, offset int32) ([]DiscountCode, int64, error)
func (s *Service) GetDiscountCode(ctx, id uuid.UUID) (DiscountCode, error)
func (s *Service) CreateDiscountCode(ctx, in DiscountInput) (DiscountCode, error)
func (s *Service) UpdateDiscountCode(ctx, id uuid.UUID, in DiscountInput) (DiscountCode, error)
func (s *Service) DeleteDiscountCode(ctx, id uuid.UUID) error // kullanılmışsa pasifleştirir
func (s *Service) validateDiscount(ctx, q *db.Queries, code string, orgID, planID int64, period string, now time.Time) (*db.BillingDiscountCode, error) // DiscountError döner
type PaymentSettings struct{ /* JSON = API sözleşmesi */ }
func (s *Service) GetPaymentSettings(ctx) (PaymentSettings, error)
func (s *Service) UpdatePaymentSettings(ctx, in PaymentSettings) (PaymentSettings, error)
func newReferenceCode(rand io.Reader) string // "OTO-" + 6 karakter
```
Doğrulama sırası (spec §6): bulunamadı → `not_found`; `!is_active` → `inactive`; `starts_at > now` → `not_started`; `ends_at < now` → `expired`; plan listesi dolu ve plan yok → `plan`; dönem listesi dolu ve dönem yok → `period`; `CountDiscountUses ≥ max_uses` → `max_uses`; `CountDiscountUsesByOrg ≥ max_uses_per_org` → `max_uses_per_org`; `first_purchase_only` ve `CountApprovedOrdersForOrg > 0` → `first_purchase_only`. Mesajlar TR (`"Kodun süresi dolmuş."` vb.). Kod girişte `strings.ToUpper(strings.TrimSpace)`; yeni kod regex `^[A-Z0-9_-]{3,40}$`. IBAN: boşlukları sil, büyük harf, `^TR\d{24}$` (boş bırakılabilir).

- [ ] **Step 1:** `discounts_test.go` birim testleri — `newReferenceCode` alfabesi/uzunluğu (sabit `bytes.Reader` ile deterministik), IBAN normalizasyonu, kod regex.
- [ ] **Step 2:** Uygula; DB tarafı Task 5'in DB testinde doğrulanır.
- [ ] **Step 3:** `go build ./... && go test ./internal/modules/billing/...`; commit `feat(billing): discount codes, payment settings and reference codes`.

---

### Task 4: Ödeme kanalı ve sipariş akışı (tenant) + süre dolumu

**Files:** Create `usecase/channels.go`, `usecase/orders.go`, `backend/internal/queue/billing_orders.go`; Modify `usecase/overview.go`, `cmd/worker/main.go`.

**Interfaces — Produces:**
```go
type Channel interface {
    Kind() string
    Instructions(ctx context.Context, order db.BillingOrder, settings db.BillingSetting) (BankInstructions, error)
}
type bankTransfer struct{} // Kind() "bank_transfer"
type OrderInput struct { PlanUUID uuid.UUID; Period, DiscountCode string }
type ReportInput struct { Note string; Filename, ContentType string; Size int64; Body io.Reader }
func (s *Service) SetStorage(d storage.Driver)
func (s *Service) PreviewOrder(ctx, in OrderInput) (OrderPreview, error)   // discount hatasını DiscountError alanına koyar, hata dönmez
func (s *Service) CreateOrder(ctx, in OrderInput) (Order, error)           // ErrOrderOpen{OrderUUID}, ErrDiscountInvalid, ErrPlanUnavailable
func (s *Service) ListOrders(ctx, status string, limit, offset int32) ([]Order, int64, error)
func (s *Service) GetOrder(ctx, id uuid.UUID) (Order, error)
func (s *Service) ReportPayment(ctx, id uuid.UUID, in ReportInput) (Order, error) // ErrOrderState
func (s *Service) CancelOrder(ctx, id uuid.UUID) (Order, error)
func (s *Service) OpenReceipt(ctx, id uuid.UUID, platform bool) (io.ReadCloser, string /*content-type*/, int64, error)
func (s *Service) ExpireDueOrders(ctx) (int, error)
```
Akış:
- `quoteFor(ctx, q, orgID, in)`: plan `is_active` ve `deleted_at IS NULL` değilse (trial kodlu plan satın alınamaz) `ErrPlanUnavailable`; `ListPrice` = aylık fiyat veya `YearlyPrice(plan)`; `PlanRank` = aylık fiyat; `Current` = `GetLiveSubscription`; `VATRate` ayarlardan; `pricing.Compute`.
- `CreateOrder` transaction: `GetOpenOrderForOrg` varsa `ErrOrderOpen`; indirim doğrula; referans kodu (çakışmada 5 deneme); `expires_at = now + order_ttl_days`; `CreateOrder`. **`total == 0` ise** aynı transaction'da onay yolu (`approveTx`, Task 5) çağrılır ve sipariş `approved` döner. Aktivite `tenant.billing.order.create`.
- `ReportPayment`: sipariş org'a ait, durum `pending_payment` veya `payment_reported` ve `expires_at > now` değilse `ErrOrderState`; dosya tipi/boyut kontrolü (`ErrInvalidRequest`); storage anahtarı `billing/receipts/{org_uuid}/{order_uuid}/{unix}-{safe_filename}`; eski dekont varsa silinir; `ReportOrder` (status `payment_reported`, `reported_at`, note, key, content type). Platform adminlerine bildirim (Task 5'teki `notifyPlatform`).
- `CancelOrder`: yalnızca açık durumlarda; `cancelled`.
- `Order` mapper `instructions`'ı açık durumlarda `Channel.Instructions` ile doldurur.
- `Overview`'a `OpenOrder *Order` (`json:"open_order"`) eklenir.
- Worker: `TaskBillingOrdersExpire = "app:billing:orders-expire"`, cron `*/15 * * * *`, `ExpireDueOrders` çağırır; `cmd/worker/main.go`'da billing servisi kurulup kaydedilir (servis constructor'ı worker'da da çalışmalı).

- [ ] **Step 1:** DB testi `orders_db_test.go` (`DATABASE_URL` yoksa skip; kendi org/plan fixture'ı, `t.Cleanup` ile **hard delete**, pool kapanışı `t.Cleanup(pool.Close)` ilk kayıt): (a) preview trial → new; (b) create → `pending_payment`, referans kodu formatı, instructions dolu; (c) ikinci create → `ErrOrderOpen`; (d) report → `payment_reported` (storage için bellek içi fake `storage.Driver`); (e) `expires_at`'i geçmişe çek → report `ErrOrderState`, `ExpireDueOrders` → `expired`; (f) `total == 0` (amount indirimi ≥ fiyat) → create doğrudan `approved`.
- [ ] **Step 2:** Uygula, testleri geçir; `go build ./... && go vet ./internal/...`.
- [ ] **Step 3:** Commit `feat(billing): bank-transfer orders with preview, receipt upload, cancel and expiry`.

---

### Task 5: Onay / red, admin abonelik yönetimi, bildirimler

**Files:** Create `usecase/approve.go`, `usecase/admin_subscriptions.go`; Modify `orders_db_test.go`, `httpserver/server.go`.

**Interfaces — Produces:**
```go
func (s *Service) ListOrdersAdmin(ctx, status, q string, limit, offset int32) ([]Order, int64, error)
func (s *Service) OrdersSummary(ctx) (OrdersSummary, error) // {PendingPayment, PaymentReported int64}
func (s *Service) GetOrderAdmin(ctx, id uuid.UUID) (Order, error)
func (s *Service) ApproveOrder(ctx, id uuid.UUID, note string) (Order, error) // ErrOrderState, ErrPlanUnavailable, ErrDiscountInvalid
func (s *Service) RejectOrder(ctx, id uuid.UUID, reason string) (Order, error) // reason zorunlu
func (s *Service) ListSubscriptionsAdmin(ctx, status, q string, limit, offset int32) ([]AdminSubscription, int64, error)
func (s *Service) CreateSubscriptionAdmin(ctx, in AdminSubscriptionInput) (AdminSubscription, error)
func (s *Service) UpdateSubscriptionAdmin(ctx, id uuid.UUID, in AdminSubscriptionPatch) (AdminSubscription, error)
type Notifier interface { NotifyOrganization(ctx context.Context, orgID int64, title, body, link string); NotifyPlatform(ctx context.Context, title, body, link string) }
func (s *Service) SetNotifier(n Notifier)
```
`approveTx(ctx, qtx, order, reviewer, note)`:
1. `GetOrderForUpdate`; durum `pending_payment|payment_reported` değilse `ErrOrderState`.
2. Plan hâlâ aktif mi → değilse `ErrPlanUnavailable`.
3. İndirim kodu varsa yeniden doğrula (`max_uses`, `max_uses_per_org`) → `ErrDiscountInvalid`; geçerse `InsertDiscountUse`.
4. `GetLiveSubscriptionForUpdate` → varsa `CloseSubscription` (note `"replaced by order OTO-…"`).
5. Yeni abonelik: plan, dönem, `status active`, `starts_at/ends_at` siparişten, `price_paid = total`, `credit_balance = credit_surplus`, `source self_service`.
6. `SetOrganizationAccess(plan_code, starts_at, ends_at)`.
7. `SetOrderStatus(approved, reviewed_by, reviewed_at, review_note, subscription_id)`.
8. Commit sonrası işletmeye bildirim (`"Aboneliğiniz aktif"`, link `/t/{slug}/settings/billing`) ve aktivite `platform.billing.order.approve`.
`RejectOrder`: açık durum şartı, `rejected` + `reject_reason`, işletmeye bildirim.
`CreateSubscriptionAdmin`: org + plan bul; `ends_at > starts_at`; canlı abonelik varsa kapat; yeni satır `source admin`, `status active` (ya da plan `trial` ise `trial`); org erişimini senkronla. `UpdateSubscriptionAdmin`: `ends_at` (uzatma/kısaltma) ve/veya plan değişimi + note; org erişimini senkronla; aktivite.
Notifier: `server.go`'da mevcut bildirim altyapısıyla (notifications servisi — quotes modülünün işletme sahiplerini bilgilendirme kalıbı ve `notifycenter`) uygulanır: işletme bildirimleri o organizasyonun `owner` üyelerine in-app; platform bildirimleri `platform.billing.write` iznine sahip (veya super admin) kullanıcılara in-app. Nil notifier = sessiz.

- [ ] **Step 1:** `orders_db_test.go`'ya: (a) report → approve → canlı abonelik `active`, `organizations.access_ends_at == order.ends_at`, eski deneme `cancelled`; (b) düşürme senaryosu: yıllık aktif abonelik (`price_paid` 9000) → aylık ucuz plan siparişi `total 0` → otomatik onay, yeni `credit_balance 8500.00`; (c) `max_uses = 1` kodla iki org sipariş → birinci onay OK, ikinci onay `ErrDiscountInvalid`; (d) reject reason boş → `ErrInvalidRequest`, dolu → `rejected`; (e) admin elle abonelik oluştur + `ends_at` uzat → org erişimi güncel.
- [ ] **Step 2:** Uygula, testleri geçir.
- [ ] **Step 3:** Commit `feat(billing): payment approval, rejection, manual subscriptions and notifications`.

---

### Task 6: Handler'lar, route'lar, OpenAPI

**Files:** Create `handler/orders.go`, `handler/platform_orders.go`, `handler/discounts.go`, `handler/settings.go`; Modify `routes.go`, `server.go`, `backend/docs/openapi.yaml`.

- [ ] **Step 1:** API sözleşmesi tablosundaki tüm route'lar; izinler tabloda. Hata eşleme: `ErrOrderOpen` → 409 `ORDER_OPEN` + details `{field:"order_uuid", message:<uuid>}`; `ErrDiscountInvalid` → 422 `DISCOUNT_INVALID` + details `{field:"reason", message:<reason>}` ve mesaj; `ErrOrderState` → 409 `ORDER_STATE`; `ErrPlanUnavailable` → 409 `PLAN_UNAVAILABLE`; mevcut `ErrNotFound/ErrInvalidRequest/ErrConflict` eşlemesi korunur. Multipart: `r.ParseMultipartForm(11 << 20)`, alan `file`, `note`. Receipt stream: `Content-Type`, `Content-Disposition: inline; filename="dekont-<ref>.<ext>"`, `Cache-Control: private, no-store`.
- [ ] **Step 2:** OpenAPI: path'ler + şemalar `BillingQuoteLine`, `BillingOrderPreview`, `BillingBankInstructions`, `BillingOrder`, `BillingOrderList`, `BillingOrdersSummary`, `BillingDiscountCode`, `BillingDiscountCodeInput`, `BillingDiscountCodeList`, `BillingAdminSubscription`, `BillingAdminSubscriptionList`, `BillingAdminSubscriptionInput`, `BillingAdminSubscriptionPatch`, `BillingPaymentSettings` + `Envelope…` sarmalları; `BillingOverview.open_order` (`nullable`). Tüm tutar alanları `type: string`.
- [ ] **Step 3:** `make -C backend openapi-lint`, `go build ./... && go vet ./internal/...`, `cd frontend && pnpm api:generate`.
- [ ] **Step 4:** Commit `feat(billing): order, payment, discount and settings endpoints with OpenAPI`.

---

### Task 7: Tenant — satın alma akışı

**Files:** Modify `features/billing/{types.ts,services/billing.service.ts,hooks/use-billing.ts,components/subscription-page.tsx}`, `locales/*/billing.json`; Create `components/{checkout-dialog.tsx,bank-instructions.tsx}`.

**Interfaces — Consumes:** Task 6 sözleşmesi. **Produces:** `billingService.{preview, createOrder, orders, order, reportPayment, cancelOrder}`, hook'lar `useOrderPreview(input, enabled)`, `useBillingOrders(status)`, `useBillingOrderMutations()` (create/report/cancel → invalidate `["tenant","billing"]`), `<CheckoutDialog plan period open onOpenChange />`, `<BankInstructions instructions />`.

- [ ] **Step 1:** Tipler `components["schemas"]` üzerinden (`BillingOrder`, `BillingOrderPreview`…).
- [ ] **Step 2:** Plan kartındaki buton: `canWrite` ve `open_order` yoksa **"Bu planı seç"** (mevcut plan + aynı dönemde **"Yenile"**), `open_order` varsa pasif ve "Açık siparişiniz var" ipucu. `canWrite` yoksa "Yalnızca işletme sahibi satın alabilir".
- [ ] **Step 3:** `CheckoutDialog`: dönem anahtarı, indirim kodu girişi (Uygula → preview yeniden), kalem tablosu (`lines`, negatifler yeşil), toplam + "KDV dahil (%20: ₺…)", `discount_error` kırmızı satır, dönem tarihleri, "Siparişi oluştur". Başarıda dialog `BankInstructions` adımına geçer; `total == 0` ise "Aboneliğiniz aktif edildi" başarı adımı.
- [ ] **Step 4:** `BankInstructions`: banka, hesap sahibi, IBAN (4'lü gruplar), tutar, referans kodu — her biri kopyala butonu (`navigator.clipboard`, toast), "Açıklamaya referans kodunu yazın" uyarısı, son ödeme tarihi (`expires_at`).
- [ ] **Step 5:** `409 ORDER_OPEN` → dialog açık siparişi gösterir; `422 DISCOUNT_INVALID` → kod alanı altında mesaj.
- [ ] **Step 6:** tsc + eslint; commit `feat(billing): tenant checkout with discount preview and bank transfer instructions`.

---

### Task 8: Tenant — sipariş durumu, dekont, geçmiş

**Files:** Create `components/{order-status-card.tsx,report-payment-dialog.tsx,orders-history.tsx}`; Modify `subscription-page.tsx`.

- [ ] **Step 1:** `OrderStatusCard` (sayfanın üstünde, `open_order` varsa): adım göstergesi *Ödeme bekleniyor → İnceleniyor → Onaylandı*, tutar/referans, `BankInstructions` (katlanır), "Ödemeyi bildir" (dekont), "Siparişi iptal et" (onaylı `ConfirmDialog`), yüklü dekont bağlantısı (`/api/v1/tenant/billing/orders/{uuid}/receipt`, yeni sekme).
- [ ] **Step 2:** `ReportPaymentDialog`: dosya seçici (pdf/jpg/png/webp, ≤10 MB, istemci kontrolü), not, `FormData` ile `POST …/report` (platformRequest JSON gönderdiği için bu çağrı `fetch` + `credentials: "include"` + `parseApiError`).
- [ ] **Step 3:** `OrdersHistory`: son siparişler tablosu (tarih, plan/dönem, tutar, durum chip'i, red nedeni tooltip).
- [ ] **Step 4:** Abonelik kartında `credit_balance > 0` ise "Alacak bakiyesi: ₺…" satırı.
- [ ] **Step 5:** tsc + eslint; commit `feat(billing): order status, payment report with receipt and order history`.

---

### Task 9: Admin — Ödemeler

**Files:** Create `features/platform-billing/components/{payments-page.tsx,payment-detail-sheet.tsx}`, `features/platform-billing/nav/index.tsx`, `app/(platform)/platform/billing/payments/page.tsx`; Modify `config/{routes.ts,nav.ts}`, hooks/services.

- [ ] **Step 1:** Liste: durum sekmeleri (*İncelenecek* = `payment_reported` varsayılan, *Ödeme bekleniyor*, *Onaylanan*, *Reddedilen*, *Tümü*), arama, tablo (işletme, plan/dönem, tutar, referans, bildirim tarihi, durum).
- [ ] **Step 2:** Detay sheet: kalemler, tutar/KDV, dekont önizleme (görselse `<img>`, PDF ise `<iframe>` yerine "Dekontu aç" bağlantısı + ilk sayfa için pdf.js gerekmez), not, "Onayla" (not opsiyonel, `ConfirmDialog`), "Reddet" (neden zorunlu). `422 DISCOUNT_INVALID`/`409 PLAN_UNAVAILABLE` mesajları sheet içinde.
- [ ] **Step 3:** Nav: "Abonelik" grubuna *Ödemeler* (rozet: `summary.payment_reported`, `PaymentsNavAdornment`, 60 sn yenileme), *Abonelikler*, *İndirim kodları*, *Ayarlar*.
- [ ] **Step 4:** tsc + eslint; commit `feat(billing): platform payments review with receipt preview`.

---

### Task 10: Admin — Abonelikler

**Files:** Create `components/{subscriptions-page.tsx,subscription-dialog.tsx}`, `app/(platform)/platform/billing/subscriptions/page.tsx`.

- [ ] **Step 1:** Tablo: işletme, plan, dönem, durum chip'i, başlangıç/bitiş, kalan gün (≤7 amber, ≤0 kırmızı), ödenen, alacak, kaynak; filtre (durum) + arama.
- [ ] **Step 2:** "Elle abonelik" dialog: işletme seçici (mevcut `/v1/platform/organizations` araması), plan, dönem (dönem değişince bitiş otomatik önerilir), başlangıç/bitiş (`admin-date-picker`), tutar (0 olabilir), not.
- [ ] **Step 3:** Satır aksiyonu "Süre uzat / düzenle": bitiş tarihi, plan, not → PATCH.
- [ ] **Step 4:** tsc + eslint; commit `feat(billing): platform subscriptions list with manual create and extend`.

---

### Task 11: Admin — İndirim kodları ve ödeme ayarları

**Files:** Create `components/{discount-codes-page.tsx,discount-code-dialog.tsx,settings-page.tsx}`, `app/(platform)/platform/billing/{discount-codes,settings}/page.tsx`.

- [ ] **Step 1:** İndirim kodları tablosu: kod (mono), tür/değer (`%10` / `₺500`), plan/dönem kısıtı, geçerlilik, kullanım `used/max`, aktif; dialog: kod (büyük harfe çevir), tür, değer, plan çoklu seçim, dönem çoklu seçim, başlangıç/bitiş (`admin-date-picker`), toplam ve işletme başına kullanım, ilk satın alma, aktif, not. Sil = kullanılmışsa pasifleştirir (toast farkı).
- [ ] **Step 2:** Ayarlar sayfası (`platform.billing.settings`): banka adı, hesap sahibi, IBAN (maskeli giriş, TR kontrolü), ödeme talimatı (textarea), sipariş bekleme günü, ek süre günü, KDV oranı.
- [ ] **Step 3:** tsc + eslint; commit `feat(billing): discount code management and payment settings`.

---

### Task 12: Uçtan uca doğrulama, ekran görüntüleri, Notion

- [ ] **Step 1:** `go test ./...` (DB dahil) ve test artığı kontrolü (`billing_orders`, `billing_discount_codes`, test org'ları).
- [ ] **Step 2:** Tarayıcı senaryosu: ayarlara banka bilgisi gir → `YAZ10` (%10, yıllık) kodu oluştur → işletme Pro yıllık + `YAZ10` önizleme → sipariş → havale bilgileri → dekont yükle → admin Ödemeler'de onayla → işletme sayfasında Pro aktif, deneme kapandı, limitler Pro'ya göre.
- [ ] **Step 3:** Playwright ile ekran görüntüleri (checkout, havale bilgileri, dekont bildirimi, sipariş durumu, admin ödemeler + detay, abonelikler, indirim kodları, ayarlar), Notion maddesine F2 bölümü + görseller (yazar/araç notu olmadan).
- [ ] **Step 4:** Yerel test verisini sıfırla (techoto'yu deneme aboneliğine döndür) ya da not düş; push.

---

## Self-review notu

- Spec §5 adımları 1–7 → Task 2 (hesap) + Task 4 (sipariş); dekont (#2) → Task 4/8; admin onayı/red → Task 5/9; elle abonelik + uzatma → Task 5/10; §6 indirim kuralları → Task 3/11; §12 tek açık sipariş, pasif plan onayı → Task 1 index + Task 4/5.
- Fatura üretimi (onayda) F3'te `approveTx` sonrasına kanca olarak eklenecek; F2'de fatura yok.
- Review Focus 1–5 testleri: Task 2 (`TestQuoteDowngradeSurplus`, `TestQuoteFromTrial`, `TestQuoteRenewStartsAtOldEnd`), Task 5 DB (c), Task 4 DB (e).
