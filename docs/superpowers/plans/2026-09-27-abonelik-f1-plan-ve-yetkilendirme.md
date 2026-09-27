# Abonelik F1 — Plan ve Yetkilendirme Çekirdeği · Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planlar, özellik kataloğu ve abonelik kaydını veritabanına almak; işletmelerin efektif limitlerini tek bir `entitlements` paketinden okuyup iş/personel/müşteri/depolama/WhatsApp/AI/modül kancalarında uygulamak; işletmeye "Abonelik" sayfası ve kullanım sayaçları, admin'e plan yönetimi vermek.

**Architecture:** Yeni `internal/modules/billing` modülü (plan/özellik/abonelik CRUD + tenant overview) ve ince `internal/platform/entitlements` paketi (karar kuralı + sayaçlar; billing'i import etmez, kendi sqlc sorgularını kullanır). Diğer modüller entitlements'ı `SetEntitlements(...)` setter'ı ile alır; nil ise her şeye izin verir (mevcut testler bozulmaz). Deneme aboneliği kayıt anında `billing_subscriptions`'a yazılır; `organizations.plan_code/access_ends_at` türetilmiş alan olarak senkron tutulur.

**Tech Stack:** Go 1.26 (net/http mux, pgx v5, sqlc, asynq), PostgreSQL, Next.js 15 + TanStack Query + shadcn/ui, openapi-typescript.

**Spec:** `docs/superpowers/specs/2026-09-27-abonelik-ve-plan-yonetimi-design.md` (§0 kararlar, §3 veri modeli, §4 yetkilendirme, §10 API, §11 frontend). Bu plan yalnızca **F1**'i kapsar; F2–F5 ayrı planlardır.

## Global Constraints

- Browser yalnızca same-origin `/api/v1/*` konuşur; Go host'a asla doğrudan gitmez.
- Yeni `/v1` route'ları aynı değişiklikte `backend/docs/openapi.yaml`'a eklenir; sonra `cd frontend && pnpm api:generate`.
- İzin slug'ları yalnızca migration + `backend/internal/platform/rbac/rbac.go` + `frontend/src/config/permissions.ts` üçlüsüyle eklenir.
- Migration numarası `000064` ile başlar (son: `000063_job_delivered_at`).
- Sorgular `backend/internal/database/queries/*.sql` → `cd backend && sqlc generate`; `db/` altındaki dosyalar elle düzenlenmez.
- Günlük/aylık sayaçlar **Europe/Istanbul** gününe göre (spec §12).
- Para birimi TRY; fiyatlar KDV **dahil** (spec #8). Deneme planı seed'i: günlük 10 işlem, 2 personel, WhatsApp ve AI kapalı, sözleşme açık, `trial_days = 14` (spec #13).
- Limit kararı (spec §4): `used+delta ≤ limit` izin; `≤ limit×(1+tolerance)` izin + `Soft`; üstü `hard` ise engel, `soft` ise izin + uyarı. Varsayılan `warn_pct = 80`.
- Hata kodları: sert engel `409 LIMIT_REACHED` (details: key, limit, used, tolerance), kapalı modül `403 FEATURE_DISABLED`.
- Commit mesajları `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` ile biter. Push edilmez; `main` üzerinde çalışılır.
- Tüm kullanıcı metinleri `frontend/src/locales/{tr,en}/billing.json` içinde; placeholder biçimi `{{name}}`.
- Frontend doğrulama: `pnpm exec tsc --noEmit -p .` ve `pnpm exec eslint src/features/billing src/features/platform-billing` temiz olmalı; backend: `go build ./... && go vet ./internal/...`.

## Review Focus

1. **Sayaç kayması (deleted jobs):** iptal/void edilen işler `jobs.daily` sayacından düşmez; gün içinde 10 iş açıp 5'ini iptal eden işletme 15. işi açamamalı mı? Beklenen: sayaç **aktif** işleri sayar (`status NOT IN ('cancelled','voided')`); Task 4'te `RecomputeUsage` testi bunu doğrular ve Task 6'daki iptal kancası `Consume(-1)` çağırır.
2. **Limit tanımsız plan:** plana özellik değeri girilmemişse (yeni eklenen builtin özellik) işletme engellenmemeli. Beklenen: sınırsız/açık. Task 3 karar tablosu testi `limit=0 & missing` durumunu ayırır (`Limit=-1` = tanımsız).
3. **Deneme süresi geçmiş mevcut işletmeler (backfill):** `access_ends_at` geçmiş olan işletmeler F1'de kilitlenmemeli (F4 gelene kadar davranış değişmez). Beklenen: backfill `status='trial'` yazar, `ends_at = access_ends_at`; entitlements yalnızca plan değerlerine bakar, tarihe bakmaz. Task 1 SQL testi.
4. **Aylık sayaç dönüm gecesi:** 23:59 İstanbul'da 30 iş, 00:01'de yeni gün → sayaç 0 olmalı. Task 4 `periodKey` testi TZ'yi UTC değil İstanbul'a göre üretir.
5. **Storage sayacı negatife düşmesin:** silme kancası sayaçtan düşerken 0'ın altına inmemeli (yeniden hesap yok). Task 4 `ConsumeUsage` sorgusu `GREATEST(0, value + delta)` kullanır; testi var.

---

## Dosya haritası

**Backend**
- `backend/migrations/000064_billing_core.up.sql` / `.down.sql` — tablolar, izinler, seed, backfill
- `backend/internal/database/queries/billing.sql` — plan/özellik/abonelik sorguları
- `backend/internal/database/queries/entitlements.sql` — efektif değerler + sayaç sorguları
- `backend/internal/platform/rbac/rbac.go` — 5 yeni slug
- `backend/internal/platform/entitlements/{entitlements.go,store.go,period.go,entitlements_test.go,store_db_test.go}`
- `backend/internal/middleware/feature.go` — `RequireFeature(key)`
- `backend/pkg/response/response.go` — `CodeLimitReached`, `CodeFeatureDisabled`
- `backend/internal/modules/billing/{routes.go,handler/handler.go,usecase/{service.go,plans.go,subscriptions.go,overview.go,types.go,service_db_test.go}}`
- Kancalar: `jobs/usecase/service.go`, `customers/usecase/service.go`, `staff/usecase/service.go`, `storage/usecase/service.go`, `messaging/usecase/outbound.go`, `ai/usecase/chat.go`, `organizations/usecase/service.go`
- `backend/internal/httpserver/server.go`, `backend/cmd/worker/main.go`, `backend/internal/queue/billing.go`
- `backend/docs/openapi.yaml`

**Frontend**
- `frontend/src/config/{permissions.ts,routes.ts,nav.ts}`
- `frontend/src/locales/{tr,en}/billing.json`, `frontend/src/lib/i18n/messages.ts`, `locales/*/permissions.json`, `locales/*/layout.json`
- `frontend/src/features/billing/{index.ts,types.ts,services/billing.service.ts,hooks/use-billing.ts,components/{subscription-page.tsx,usage-meter.tsx,limit-reached-dialog.tsx,feature-locked.tsx},lib/limit-events.ts}`
- `frontend/src/features/platform-billing/{index.ts,services/platform-billing.service.ts,hooks/use-platform-billing.ts,components/{plans-page.tsx,plan-dialog.tsx}}`
- `frontend/src/app/(tenant)/t/[slug]/settings/billing/page.tsx`, `frontend/src/app/(platform)/platform/billing/plans/page.tsx`
- Sayaç yerleşimi: `features/jobs/components/jobs-page.tsx`, `features/staff/components/staff-page.tsx`, `features/customers/components/customers-page.tsx`
- `frontend/src/lib/api/platform-request.ts` (LIMIT_REACHED olayı)

---

### Task 1: Migration — tablolar, izinler, seed, backfill

**Files:**
- Create: `backend/migrations/000064_billing_core.up.sql`, `backend/migrations/000064_billing_core.down.sql`
- Modify: `backend/internal/platform/rbac/rbac.go` (slug sabitleri)

**Interfaces:**
- Produces: tablolar `billing_features`, `billing_plans`, `billing_plan_features`, `billing_subscriptions`, `billing_usage_counters`; izin slug'ları `platform.billing.read`, `platform.billing.write`, `platform.billing.settings`, `tenant.billing.read`, `tenant.billing.write`; `rbac.PermPlatformBillingRead/Write/Settings`, `rbac.PermTenantBillingRead/Write`.

- [ ] **Step 1: Up migration'ı yaz**

```sql
-- backend/migrations/000064_billing_core.up.sql
-- Subscription core: feature catalog, plans, plan feature values, per-org
-- subscriptions and periodic usage counters (spec §3). Trial stays a plan.

CREATE TABLE billing_features (
    id          BIGSERIAL    PRIMARY KEY,
    key         VARCHAR(64)  NOT NULL,
    kind        VARCHAR(16)  NOT NULL,            -- limit | toggle | display
    unit        VARCHAR(16)  NOT NULL DEFAULT '', -- adet, GB, ...
    period      VARCHAR(8)   NOT NULL DEFAULT 'none', -- day | month | total | none
    label_tr    VARCHAR(120) NOT NULL,
    label_en    VARCHAR(120) NOT NULL,
    sort_order  INT          NOT NULL DEFAULT 0,
    is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_features_key UNIQUE (key),
    CONSTRAINT chk_billing_features_kind CHECK (kind IN ('limit', 'toggle', 'display')),
    CONSTRAINT chk_billing_features_period CHECK (period IN ('day', 'month', 'total', 'none'))
);
CREATE TRIGGER trg_billing_features_set_updated_at BEFORE UPDATE ON billing_features
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_plans (
    id                    BIGSERIAL      PRIMARY KEY,
    uuid                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    code                  VARCHAR(32)    NOT NULL,
    name                  VARCHAR(100)   NOT NULL,
    description           TEXT           NOT NULL DEFAULT '',
    price_monthly         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    yearly_pricing        VARCHAR(16)    NOT NULL DEFAULT 'fixed', -- fixed | discount_amount | discount_percent
    price_yearly          NUMERIC(18, 2) NOT NULL DEFAULT 0,
    yearly_discount_value NUMERIC(18, 2) NOT NULL DEFAULT 0,
    currency              CHAR(3)        NOT NULL DEFAULT 'TRY',
    trial_days            INT            NOT NULL DEFAULT 0,
    is_public             BOOLEAN        NOT NULL DEFAULT TRUE,
    is_customizable       BOOLEAN        NOT NULL DEFAULT FALSE,
    badge                 VARCHAR(16)    NOT NULL DEFAULT '',
    sort_order            INT            NOT NULL DEFAULT 0,
    is_active             BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ    NULL,
    CONSTRAINT uq_billing_plans_uuid UNIQUE (uuid),
    CONSTRAINT chk_billing_plans_yearly CHECK (yearly_pricing IN ('fixed', 'discount_amount', 'discount_percent'))
);
CREATE UNIQUE INDEX uq_billing_plans_code_active ON billing_plans (code) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_billing_plans_set_updated_at BEFORE UPDATE ON billing_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_plan_features (
    id            BIGSERIAL      PRIMARY KEY,
    plan_id       BIGINT         NOT NULL REFERENCES billing_plans (id) ON DELETE CASCADE,
    feature_id    BIGINT         NOT NULL REFERENCES billing_features (id) ON DELETE CASCADE,
    value_int     BIGINT         NULL,
    value_bool    BOOLEAN        NULL,
    display_text  VARCHAR(200)   NOT NULL DEFAULT '',
    enforcement   VARCHAR(8)     NOT NULL DEFAULT 'hard', -- hard | soft
    tolerance_pct INT            NOT NULL DEFAULT 0,
    warn_pct      INT            NOT NULL DEFAULT 80,
    min_value     BIGINT         NULL,
    max_value     BIGINT         NULL,
    step          BIGINT         NULL,
    unit_price    NUMERIC(18, 2) NULL,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_plan_features UNIQUE (plan_id, feature_id),
    CONSTRAINT chk_billing_plan_features_enforcement CHECK (enforcement IN ('hard', 'soft')),
    CONSTRAINT chk_billing_plan_features_pct CHECK (tolerance_pct BETWEEN 0 AND 100 AND warn_pct BETWEEN 0 AND 100)
);
CREATE TRIGGER trg_billing_plan_features_set_updated_at BEFORE UPDATE ON billing_plan_features
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_subscriptions (
    id              BIGSERIAL      PRIMARY KEY,
    uuid            UUID           NOT NULL DEFAULT gen_random_uuid(),
    organization_id BIGINT         NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    plan_id         BIGINT         NOT NULL REFERENCES billing_plans (id),
    period          VARCHAR(8)     NOT NULL DEFAULT 'monthly', -- monthly | yearly
    status          VARCHAR(16)    NOT NULL,                   -- trial | active | grace | read_only | cancelled
    starts_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    ends_at         TIMESTAMPTZ    NOT NULL,
    grace_ends_at   TIMESTAMPTZ    NULL,
    price_paid      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    credit_balance  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    custom_features JSONB          NOT NULL DEFAULT '{}'::jsonb,
    source          VARCHAR(16)    NOT NULL DEFAULT 'self_service', -- self_service | admin
    note            TEXT           NOT NULL DEFAULT '',
    created_by      BIGINT         NULL REFERENCES users (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_billing_subscriptions_uuid UNIQUE (uuid),
    CONSTRAINT chk_billing_subscriptions_period CHECK (period IN ('monthly', 'yearly')),
    CONSTRAINT chk_billing_subscriptions_status CHECK (status IN ('trial', 'active', 'grace', 'read_only', 'cancelled'))
);
-- One live subscription per organization.
CREATE UNIQUE INDEX uq_billing_subscriptions_live
    ON billing_subscriptions (organization_id) WHERE status IN ('trial', 'active', 'grace', 'read_only');
CREATE INDEX idx_billing_subscriptions_ends_at ON billing_subscriptions (ends_at);
CREATE TRIGGER trg_billing_subscriptions_set_updated_at BEFORE UPDATE ON billing_subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_usage_counters (
    organization_id BIGINT      NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    feature_key     VARCHAR(64) NOT NULL,
    period_key      VARCHAR(10) NOT NULL, -- 2026-09-27 | 2026-09 | total
    value           BIGINT      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, feature_key, period_key)
);

-- Permissions (spec §10).
INSERT INTO permissions (name, slug) VALUES
    ('Read platform billing', 'platform.billing.read'),
    ('Write platform billing', 'platform.billing.write'),
    ('Manage platform billing settings', 'platform.billing.settings'),
    ('Read tenant billing', 'tenant.billing.read'),
    ('Write tenant billing', 'tenant.billing.write')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug IN ('platform.billing.read', 'platform.billing.write', 'platform.billing.settings')
WHERE r.slug = 'super_admin' ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug IN ('tenant.billing.read')
WHERE r.slug IN ('organization_owner', 'organization_user', 'super_admin') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.slug IN ('tenant.billing.write')
WHERE r.slug IN ('organization_owner', 'super_admin') ON CONFLICT DO NOTHING;

-- Builtin feature catalog (spec §4 table). Code upserts the same rows at boot.
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin) VALUES
    ('jobs.daily',       'limit',  'adet', 'day',   'Günlük işlem',            'Daily jobs',              10, TRUE),
    ('jobs.monthly',     'limit',  'adet', 'month', 'Aylık işlem',             'Monthly jobs',            20, TRUE),
    ('staff.count',      'limit',  'kişi', 'total', 'Personel sayısı',         'Staff members',           30, TRUE),
    ('customers.count',  'limit',  'adet', 'total', 'Müşteri kaydı',           'Customer records',        40, TRUE),
    ('storage.gb',       'limit',  'GB',   'total', 'Depolama alanı',          'Storage',                 50, TRUE),
    ('whatsapp.enabled', 'toggle', '',     'none',  'WhatsApp mesajlaşma',     'WhatsApp messaging',      60, TRUE),
    ('whatsapp.monthly', 'limit',  'mesaj','month', 'Aylık WhatsApp mesajı',   'Monthly WhatsApp messages',61, TRUE),
    ('ai.enabled',       'toggle', '',     'none',  'Yapay zekâ asistanı',     'AI assistant',            70, TRUE),
    ('ai.monthly',       'limit',  'istek','month', 'Aylık AI isteği',         'Monthly AI requests',     71, TRUE),
    ('module.contracts', 'toggle', '',     'none',  'Sözleşme modülü',         'Contracts module',        80, TRUE),
    ('module.quotes',    'toggle', '',     'none',  'Teklif ve fırsat modülü', 'Quotes & leads module',   90, TRUE),
    ('module.reports',   'toggle', '',     'none',  'Raporlar ve dışa aktarım','Reports & exports',      100, TRUE)
ON CONFLICT (key) DO NOTHING;

-- Trial plan + its limits (spec #13).
INSERT INTO billing_plans (code, name, description, price_monthly, price_yearly, trial_days, is_public, sort_order)
VALUES ('trial', 'Deneme', '14 gün ücretsiz deneme', 0, 0, 14, FALSE, 0);

INSERT INTO billing_plan_features (plan_id, feature_id, value_int, value_bool, enforcement, tolerance_pct)
SELECT p.id, f.id, v.value_int, v.value_bool, 'hard', 0
FROM billing_plans p, (VALUES
    ('jobs.daily',       10::bigint, NULL::boolean),
    ('staff.count',      2,          NULL),
    ('whatsapp.enabled', NULL,       FALSE),
    ('ai.enabled',       NULL,       FALSE),
    ('module.contracts', NULL,       TRUE),
    ('module.quotes',    NULL,       TRUE),
    ('module.reports',   NULL,       TRUE)
) AS v(key, value_int, value_bool)
JOIN billing_features f ON f.key = v.key
WHERE p.code = 'trial';

-- Backfill: every existing organization gets a trial subscription mirroring
-- organizations.access_*. Expired ones stay 'trial' too — F4 owns the
-- grace / read-only transitions; nothing changes for them in F1.
INSERT INTO billing_subscriptions (organization_id, plan_id, period, status, starts_at, ends_at, source, note)
SELECT o.id, p.id, 'monthly', 'trial', o.access_starts_at,
       COALESCE(o.access_ends_at, o.access_starts_at + INTERVAL '14 days'), 'admin', 'backfill 000064'
FROM organizations o, billing_plans p
WHERE p.code = 'trial' AND o.deleted_at IS NULL;
```

- [ ] **Step 2: Down migration'ı yaz**

```sql
-- backend/migrations/000064_billing_core.down.sql
DROP TABLE IF EXISTS billing_usage_counters;
DROP TABLE IF EXISTS billing_subscriptions;
DROP TABLE IF EXISTS billing_plan_features;
DROP TABLE IF EXISTS billing_plans;
DROP TABLE IF EXISTS billing_features;
DELETE FROM role_permissions WHERE permission_id IN (
    SELECT id FROM permissions WHERE slug IN (
        'platform.billing.read', 'platform.billing.write', 'platform.billing.settings',
        'tenant.billing.read', 'tenant.billing.write'));
DELETE FROM permissions WHERE slug IN (
    'platform.billing.read', 'platform.billing.write', 'platform.billing.settings',
    'tenant.billing.read', 'tenant.billing.write');
```

- [ ] **Step 3: rbac sabitlerini ekle** — `rbac.go` const bloğunun sonuna (`PermTenantQuotesWrite` satırından sonra):

```go
	PermPlatformBillingRead     = "platform.billing.read"
	PermPlatformBillingWrite    = "platform.billing.write"
	PermPlatformBillingSettings = "platform.billing.settings"
	PermTenantBillingRead       = "tenant.billing.read"
	PermTenantBillingWrite      = "tenant.billing.write"
```

- [ ] **Step 4: Migration'ı uygula ve backfill'i doğrula**

Run: `cd /Users/furkanmeclis/Documents/Projects/otopoly-go && set -a && . ./.env && set +a && make -C backend migrate-up && docker exec otopoly-postgres psql -U app -d app -At -c "select count(*) from billing_subscriptions s join billing_plans p on p.id=s.plan_id where p.code='trial'" && docker exec otopoly-postgres psql -U app -d app -At -c "select count(*) from organizations where deleted_at is null"`
Expected: iki sayı eşit; `64/u billing_core` satırı.

- [ ] **Step 5: Down/up gidip gel** — `make -C backend migrate-down` sonra `migrate-up`; hata yok (Makefile'daki hedef adını `grep -n migrate-down backend/Makefile` ile doğrula; yoksa `migrate -path backend/migrations -database "$DATABASE_URL" down 1`).

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/000064_billing_core.up.sql backend/migrations/000064_billing_core.down.sql backend/internal/platform/rbac/rbac.go
git commit -m "feat(billing): core tables, permissions, trial plan seed and backfill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: sqlc sorguları — plan/özellik/abonelik + entitlements

**Files:**
- Create: `backend/internal/database/queries/billing.sql`, `backend/internal/database/queries/entitlements.sql`

**Interfaces:**
- Produces (sqlc): `ListBillingFeatures`, `UpsertBuiltinFeature`, `CreateDisplayFeature`, `UpdateFeatureActive`, `ListBillingPlans`, `GetBillingPlanByUUID`, `GetBillingPlanByCode`, `CreateBillingPlan`, `UpdateBillingPlan`, `SoftDeleteBillingPlan`, `ListPlanFeatures`, `DeletePlanFeatures`, `InsertPlanFeature`, `GetLiveSubscription`, `CreateSubscription`, `SetOrganizationAccess`, `CountLiveSubscriptionsByPlan`, `GetEffectiveFeatures`, `GetUsageCounter`, `ConsumeUsage`, `SetUsageCounter`, `ListUsageCounters`, `CountActiveJobsInRange`, `CountOrgMembers`, `CountOrgCustomers`, `ListOrganizationIDs`.

- [ ] **Step 1: `billing.sql` yaz**

```sql
-- Plans, feature catalog and subscriptions (spec §3).

-- name: ListBillingFeatures :many
SELECT * FROM billing_features WHERE (sqlc.arg(include_inactive)::boolean OR is_active) ORDER BY sort_order, id;

-- name: UpsertBuiltinFeature :exec
INSERT INTO billing_features (key, kind, unit, period, label_tr, label_en, sort_order, is_builtin)
VALUES (sqlc.arg(key), sqlc.arg(kind), sqlc.arg(unit), sqlc.arg(period), sqlc.arg(label_tr), sqlc.arg(label_en), sqlc.arg(sort_order), TRUE)
ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, unit = EXCLUDED.unit, period = EXCLUDED.period, is_builtin = TRUE;

-- name: CreateDisplayFeature :one
INSERT INTO billing_features (key, kind, label_tr, label_en, sort_order, is_builtin)
VALUES (sqlc.arg(key), 'display', sqlc.arg(label_tr), sqlc.arg(label_en), sqlc.arg(sort_order), FALSE)
RETURNING *;

-- name: UpdateFeatureActive :exec
UPDATE billing_features SET is_active = sqlc.arg(is_active) WHERE id = sqlc.arg(id) AND is_builtin = FALSE;

-- name: ListBillingPlans :many
SELECT * FROM billing_plans
WHERE deleted_at IS NULL AND (sqlc.arg(public_only)::boolean = FALSE OR (is_public AND is_active))
ORDER BY sort_order, id;

-- name: GetBillingPlanByUUID :one
SELECT * FROM billing_plans WHERE uuid = $1 AND deleted_at IS NULL;

-- name: GetBillingPlanByCode :one
SELECT * FROM billing_plans WHERE code = $1 AND deleted_at IS NULL;

-- name: CreateBillingPlan :one
INSERT INTO billing_plans (code, name, description, price_monthly, yearly_pricing, price_yearly, yearly_discount_value,
    trial_days, is_public, is_customizable, badge, sort_order, is_active)
VALUES (sqlc.arg(code), sqlc.arg(name), sqlc.arg(description), sqlc.arg(price_monthly), sqlc.arg(yearly_pricing),
    sqlc.arg(price_yearly), sqlc.arg(yearly_discount_value), sqlc.arg(trial_days), sqlc.arg(is_public),
    sqlc.arg(is_customizable), sqlc.arg(badge), sqlc.arg(sort_order), sqlc.arg(is_active))
RETURNING *;

-- name: UpdateBillingPlan :one
UPDATE billing_plans
SET name = sqlc.arg(name), description = sqlc.arg(description), price_monthly = sqlc.arg(price_monthly),
    yearly_pricing = sqlc.arg(yearly_pricing), price_yearly = sqlc.arg(price_yearly),
    yearly_discount_value = sqlc.arg(yearly_discount_value), trial_days = sqlc.arg(trial_days),
    is_public = sqlc.arg(is_public), is_customizable = sqlc.arg(is_customizable), badge = sqlc.arg(badge),
    sort_order = sqlc.arg(sort_order), is_active = sqlc.arg(is_active)
WHERE uuid = sqlc.arg(uuid) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteBillingPlan :exec
UPDATE billing_plans SET deleted_at = NOW(), is_active = FALSE WHERE uuid = $1 AND deleted_at IS NULL;

-- name: CountLiveSubscriptionsByPlan :one
SELECT COUNT(*)::bigint FROM billing_subscriptions
WHERE plan_id = $1 AND status IN ('trial', 'active', 'grace', 'read_only');

-- name: ListPlanFeatures :many
SELECT pf.*, f.key, f.kind, f.unit, f.period, f.label_tr, f.label_en
FROM billing_plan_features pf JOIN billing_features f ON f.id = pf.feature_id
WHERE pf.plan_id = $1 ORDER BY f.sort_order, f.id;

-- name: DeletePlanFeatures :exec
DELETE FROM billing_plan_features WHERE plan_id = $1;

-- name: InsertPlanFeature :exec
INSERT INTO billing_plan_features (plan_id, feature_id, value_int, value_bool, display_text, enforcement, tolerance_pct, warn_pct,
    min_value, max_value, step, unit_price)
SELECT sqlc.arg(plan_id), f.id, sqlc.narg(value_int), sqlc.narg(value_bool), sqlc.arg(display_text), sqlc.arg(enforcement),
    sqlc.arg(tolerance_pct), sqlc.arg(warn_pct), sqlc.narg(min_value), sqlc.narg(max_value), sqlc.narg(step), sqlc.narg(unit_price)
FROM billing_features f WHERE f.key = sqlc.arg(feature_key);

-- name: GetLiveSubscription :one
SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.uuid AS plan_uuid
FROM billing_subscriptions s JOIN billing_plans p ON p.id = s.plan_id
WHERE s.organization_id = $1 AND s.status IN ('trial', 'active', 'grace', 'read_only');

-- name: CreateSubscription :one
INSERT INTO billing_subscriptions (organization_id, plan_id, period, status, starts_at, ends_at, price_paid, source, note, created_by)
VALUES (sqlc.arg(organization_id), sqlc.arg(plan_id), sqlc.arg(period), sqlc.arg(status), sqlc.arg(starts_at), sqlc.arg(ends_at),
    sqlc.arg(price_paid), sqlc.arg(source), sqlc.arg(note), sqlc.narg(created_by))
RETURNING *;

-- name: SetOrganizationAccess :exec
UPDATE organizations SET plan_code = sqlc.arg(plan_code), access_starts_at = sqlc.arg(access_starts_at), access_ends_at = sqlc.arg(access_ends_at)
WHERE id = sqlc.arg(id);

-- name: ListOrganizationIDs :many
SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY id;
```

- [ ] **Step 2: `entitlements.sql` yaz**

```sql
-- Effective feature values and usage counters for platform/entitlements.

-- name: GetEffectiveFeatures :many
-- Plan values of the organization's live subscription plus the custom
-- override JSON (enterprise, F5). Missing rows mean "unlimited / enabled".
SELECT f.key, f.kind, f.period, pf.value_int, pf.value_bool, pf.enforcement, pf.tolerance_pct, pf.warn_pct,
       (s.custom_features ->> f.key) AS custom_value
FROM billing_subscriptions s
JOIN billing_plan_features pf ON pf.plan_id = s.plan_id
JOIN billing_features f ON f.id = pf.feature_id AND f.is_active
WHERE s.organization_id = $1 AND s.status IN ('trial', 'active', 'grace', 'read_only');

-- name: GetUsageCounter :one
SELECT COALESCE((SELECT value FROM billing_usage_counters WHERE organization_id = $1 AND feature_key = $2 AND period_key = $3), 0)::bigint AS value;

-- name: ConsumeUsage :one
INSERT INTO billing_usage_counters (organization_id, feature_key, period_key, value)
VALUES ($1, $2, $3, GREATEST(0, sqlc.arg(delta)::bigint))
ON CONFLICT (organization_id, feature_key, period_key)
DO UPDATE SET value = GREATEST(0, billing_usage_counters.value + sqlc.arg(delta)::bigint), updated_at = NOW()
RETURNING value;

-- name: SetUsageCounter :exec
INSERT INTO billing_usage_counters (organization_id, feature_key, period_key, value)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, feature_key, period_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- name: ListUsageCounters :many
SELECT feature_key, period_key, value FROM billing_usage_counters
WHERE organization_id = $1 AND period_key = ANY(sqlc.arg(period_keys)::text[]);

-- name: CountActiveJobsInRange :one
SELECT COUNT(*)::bigint FROM service_jobs
WHERE organization_id = $1 AND status NOT IN ('cancelled', 'voided')
  AND started_at >= sqlc.arg(from_at) AND started_at < sqlc.arg(to_at);

-- name: CountOrgMembers :one
SELECT COUNT(*)::bigint FROM organization_members om JOIN users u ON u.id = om.user_id AND u.deleted_at IS NULL
WHERE om.organization_id = $1;

-- name: CountOrgCustomers :one
SELECT COUNT(*)::bigint FROM customers WHERE organization_id = $1 AND deleted_at IS NULL;
```

- [ ] **Step 3: Üret ve derle**

Run: `cd backend && sqlc generate && go build ./...`
Expected: hata yok; `internal/database/db/billing.sql.go` ve `entitlements.sql.go` oluşur.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/database
git commit -m "feat(billing): sqlc queries for plans, features, subscriptions and usage counters

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `platform/entitlements` — karar kuralı (birim test)

**Files:**
- Create: `backend/internal/platform/entitlements/entitlements.go`, `backend/internal/platform/entitlements/entitlements_test.go`

**Interfaces:**
- Produces:
```go
package entitlements
const ( KindLimit = "limit"; KindToggle = "toggle"; PeriodDay = "day"; PeriodMonth = "month"; PeriodTotal = "total" )
type Feature struct { Key, Kind, Period, Enforcement string; Limit int64 /* -1 = tanımsız */; Enabled bool; TolerancePct, WarnPct int }
type Decision struct { Allowed, Soft, Defined bool; Key string; Limit, Used, Tolerance, WarnAt int64 }
type Usage struct { Key, PeriodKey string; Limit, Used int64; WarnPct, TolerancePct int; Enforcement string }
type Snapshot struct { Features []Feature; Usage []Usage }
type Store interface {
    Features(ctx context.Context, orgID int64) ([]Feature, error)
    Usage(ctx context.Context, orgID int64, key, periodKey string) (int64, error)
    Consume(ctx context.Context, orgID int64, key, periodKey string, delta int64) (int64, error)
}
type Service struct { /* store, now, loc */ }
func New(store Store) *Service
func (s *Service) SetClock(func() time.Time)
func Decide(f Feature, used, delta int64) Decision   // saf fonksiyon
func (s *Service) Check(ctx, orgID int64, key string, delta int64) (Decision, error)
func (s *Service) Consume(ctx, orgID int64, key string, delta int64) error
func (s *Service) Enabled(ctx, orgID int64, key string) (bool, error)
func (s *Service) Snapshot(ctx, orgID int64) (Snapshot, error)
var ErrLimitReached = errors.New("limit reached"); var ErrFeatureDisabled = errors.New("feature disabled")
type LimitError struct{ Decision } // errors.Is(err, ErrLimitReached)
```

- [ ] **Step 1: Karar tablosu testini yaz**

```go
// backend/internal/platform/entitlements/entitlements_test.go
package entitlements

import "testing"

func TestDecide(t *testing.T) {
	hard := Feature{Key: "jobs.daily", Kind: KindLimit, Enforcement: "hard", Limit: 30, TolerancePct: 10, WarnPct: 80}
	soft := hard
	soft.Enforcement = "soft"
	undefined := Feature{Key: "jobs.daily", Kind: KindLimit, Limit: -1}
	zero := Feature{Key: "jobs.daily", Kind: KindLimit, Enforcement: "hard", Limit: 0}
	cases := []struct {
		name        string
		f           Feature
		used, delta int64
		allowed     bool
		soft        bool
	}{
		{"under limit", hard, 10, 1, true, false},
		{"exactly at limit", hard, 29, 1, true, false},
		{"inside tolerance", hard, 31, 1, true, true},   // 32 ≤ 33
		{"tolerance edge", hard, 32, 1, true, true},     // 33 ≤ 33
		{"over tolerance hard", hard, 33, 1, false, true},
		{"over tolerance soft", soft, 40, 1, true, true},
		{"undefined is unlimited", undefined, 1_000_000, 1, true, false},
		{"zero limit hard blocks first", zero, 0, 1, false, true},
		{"negative delta always allowed", hard, 40, -1, true, false},
	}
	for _, c := range cases {
		d := Decide(c.f, c.used, c.delta)
		if d.Allowed != c.allowed || d.Soft != c.soft {
			t.Errorf("%s: allowed=%v soft=%v want %v/%v (%+v)", c.name, d.Allowed, d.Soft, c.allowed, c.soft, d)
		}
	}
	d := Decide(hard, 10, 1)
	if d.Tolerance != 33 || d.WarnAt != 24 || d.Limit != 30 {
		t.Errorf("derived numbers: %+v", d)
	}
}

func TestDecideToggle(t *testing.T) {
	on := Feature{Key: "ai.enabled", Kind: KindToggle, Enabled: true}
	off := on
	off.Enabled = false
	if !Decide(on, 0, 1).Allowed || Decide(off, 0, 1).Allowed {
		t.Fatal("toggle must follow Enabled")
	}
}
```

- [ ] **Step 2: Testi çalıştır, derlenmediğini gör**

Run: `cd backend && go test ./internal/platform/entitlements/ -run TestDecide`
Expected: FAIL — `undefined: Decide`.

- [ ] **Step 3: Paketi yaz**

```go
// backend/internal/platform/entitlements/entitlements.go
// Package entitlements answers "may this organization do X once more?" from
// its live subscription's feature values (spec §4). It never imports the
// billing module; it reads plan values and usage counters through Store.
package entitlements

import (
	"context"
	"errors"
	"fmt"
	"time"
)

const (
	KindLimit  = "limit"
	KindToggle = "toggle"

	PeriodDay   = "day"
	PeriodMonth = "month"
	PeriodTotal = "total"
)

var (
	ErrLimitReached    = errors.New("limit reached")
	ErrFeatureDisabled = errors.New("feature disabled")
)

// Feature is the effective value of one feature for an organization.
// Limit -1 means the plan defines nothing for it (= unlimited).
type Feature struct {
	Key          string
	Kind         string
	Period       string
	Enforcement  string // hard | soft
	Limit        int64
	Enabled      bool
	TolerancePct int
	WarnPct      int
}

// Decision is the outcome for one Check.
type Decision struct {
	Allowed   bool
	Soft      bool // limit exceeded but tolerated (or soft enforcement)
	Defined   bool // false when the plan has no value for the key
	Key       string
	Limit     int64
	Used      int64
	Tolerance int64 // limit × (1 + tolerance_pct)
	WarnAt    int64 // limit × warn_pct
}

// LimitError carries the decision to the HTTP layer (409 LIMIT_REACHED).
type LimitError struct{ Decision }

func (e *LimitError) Error() string {
	return fmt.Sprintf("limit reached: %s %d/%d", e.Key, e.Used, e.Limit)
}
func (e *LimitError) Is(target error) bool { return target == ErrLimitReached }

// Usage is one feature's counter for the UI snapshot.
type Usage struct {
	Key          string
	PeriodKey    string
	Limit        int64
	Used         int64
	WarnPct      int
	TolerancePct int
	Enforcement  string
}

// Snapshot is everything the tenant UI needs to draw meters.
type Snapshot struct {
	Features []Feature
	Usage    []Usage
}

// Store is the persistence seam (DB-backed in store.go, fakes in tests).
type Store interface {
	Features(ctx context.Context, orgID int64) ([]Feature, error)
	Usage(ctx context.Context, orgID int64, key, periodKey string) (int64, error)
	Consume(ctx context.Context, orgID int64, key, periodKey string, delta int64) (int64, error)
}

// Service evaluates decisions; a nil *Service allows everything so modules
// keep working when billing is not wired (tests, worker).
type Service struct {
	store Store
	now   func() time.Time
	loc   *time.Location
}

func New(store Store) *Service {
	loc, err := time.LoadLocation("Europe/Istanbul")
	if err != nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	return &Service{store: store, now: time.Now, loc: loc}
}

func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Decide applies the rule table (spec §4) without touching storage.
func Decide(f Feature, used, delta int64) Decision {
	d := Decision{Key: f.Key, Used: used, Limit: f.Limit, Defined: f.Limit >= 0 || f.Kind == KindToggle}
	if f.Kind == KindToggle {
		d.Allowed = f.Enabled
		return d
	}
	if f.Limit < 0 || delta <= 0 {
		d.Allowed = true
		return d
	}
	d.Tolerance = f.Limit + f.Limit*int64(f.TolerancePct)/100
	d.WarnAt = f.Limit * int64(f.WarnPct) / 100
	next := used + delta
	switch {
	case next <= f.Limit:
		d.Allowed = true
	case next <= d.Tolerance:
		d.Allowed, d.Soft = true, true
	default:
		d.Soft = true
		d.Allowed = f.Enforcement == "soft"
	}
	return d
}

func (s *Service) feature(ctx context.Context, orgID int64, key string) (Feature, error) {
	feats, err := s.store.Features(ctx, orgID)
	if err != nil {
		return Feature{}, err
	}
	for _, f := range feats {
		if f.Key == key {
			return f, nil
		}
	}
	return Feature{Key: key, Kind: KindLimit, Limit: -1}, nil // undefined → unlimited
}

// Check evaluates key for delta more units. Callers treat a returned
// *LimitError as 409 and log Decision.Soft for warnings.
func (s *Service) Check(ctx context.Context, orgID int64, key string, delta int64) (Decision, error) {
	if s == nil {
		return Decision{Allowed: true, Key: key, Limit: -1}, nil
	}
	f, err := s.feature(ctx, orgID, key)
	if err != nil {
		return Decision{}, err
	}
	var used int64
	if f.Kind == KindLimit && f.Limit >= 0 {
		if used, err = s.store.Usage(ctx, orgID, key, s.periodKey(f.Period)); err != nil {
			return Decision{}, err
		}
	}
	d := Decide(f, used, delta)
	if !d.Allowed {
		if f.Kind == KindToggle {
			return d, ErrFeatureDisabled
		}
		return d, &LimitError{d}
	}
	return d, nil
}

// Consume moves the counter after the action succeeded (negative = give back).
func (s *Service) Consume(ctx context.Context, orgID int64, key string, delta int64) error {
	if s == nil {
		return nil
	}
	f, err := s.feature(ctx, orgID, key)
	if err != nil {
		return err
	}
	_, err = s.store.Consume(ctx, orgID, key, s.periodKey(f.Period), delta)
	return err
}

// Enabled reports a toggle; undefined toggles are on.
func (s *Service) Enabled(ctx context.Context, orgID int64, key string) (bool, error) {
	if s == nil {
		return true, nil
	}
	feats, err := s.store.Features(ctx, orgID)
	if err != nil {
		return false, err
	}
	for _, f := range feats {
		if f.Key == key && f.Kind == KindToggle {
			return f.Enabled, nil
		}
	}
	return true, nil
}

// Snapshot returns all features with current usage for the tenant UI.
func (s *Service) Snapshot(ctx context.Context, orgID int64) (Snapshot, error) {
	if s == nil {
		return Snapshot{}, nil
	}
	feats, err := s.store.Features(ctx, orgID)
	if err != nil {
		return Snapshot{}, err
	}
	out := Snapshot{Features: feats}
	for _, f := range feats {
		if f.Kind != KindLimit {
			continue
		}
		pk := s.periodKey(f.Period)
		used, err := s.store.Usage(ctx, orgID, f.Key, pk)
		if err != nil {
			return Snapshot{}, err
		}
		out.Usage = append(out.Usage, Usage{Key: f.Key, PeriodKey: pk, Limit: f.Limit, Used: used,
			WarnPct: f.WarnPct, TolerancePct: f.TolerancePct, Enforcement: f.Enforcement})
	}
	return out, nil
}
```

`period.go`:

```go
package entitlements

import "time"

// periodKey is the counter bucket for a period, in Europe/Istanbul.
func (s *Service) periodKey(period string) string {
	return PeriodKeyAt(period, s.now().In(s.loc))
}

// PeriodKeyAt is exported for the recompute job and tests.
func PeriodKeyAt(period string, t time.Time) string {
	switch period {
	case PeriodDay:
		return t.Format("2006-01-02")
	case PeriodMonth:
		return t.Format("2006-01")
	default:
		return "total"
	}
}
```

- [ ] **Step 4: Period testi ekle** — `entitlements_test.go` sonuna:

```go
func TestPeriodKeyIstanbul(t *testing.T) {
	loc, _ := time.LoadLocation("Europe/Istanbul")
	// 23:30 UTC on the 26th is 02:30 on the 27th in Istanbul.
	at := time.Date(2026, 9, 26, 23, 30, 0, 0, time.UTC).In(loc)
	if got := PeriodKeyAt(PeriodDay, at); got != "2026-09-27" {
		t.Fatalf("day key %s", got)
	}
	if got := PeriodKeyAt(PeriodMonth, at); got != "2026-09" {
		t.Fatalf("month key %s", got)
	}
	if got := PeriodKeyAt(PeriodTotal, at); got != "total" {
		t.Fatalf("total key %s", got)
	}
}
```
(`"time"` import'unu ekle.)

- [ ] **Step 5: Testleri çalıştır**

Run: `cd backend && go test ./internal/platform/entitlements/ -v`
Expected: `TestDecide`, `TestDecideToggle`, `TestPeriodKeyIstanbul` PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/platform/entitlements
git commit -m "feat(entitlements): decision rule, period keys and service seam

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: DB store, sayaç yeniden hesabı ve worker görevi

**Files:**
- Create: `backend/internal/platform/entitlements/store.go`, `backend/internal/platform/entitlements/recompute.go`, `backend/internal/platform/entitlements/store_db_test.go`, `backend/internal/queue/billing.go`
- Modify: `backend/cmd/worker/main.go`

**Interfaces:**
- Produces: `entitlements.NewDBStore(q *db.Queries) *DBStore`; `(*Service).RecomputeUsage(ctx, orgID int64) error`; `(*Service).RecomputeAll(ctx) (int, error)`; `queue.TaskBillingRecompute`, `queue.(*Worker).WithBillingRecompute(fn func(context.Context) (int, error))`, `queue.RegisterBillingRecomputeSchedule(scheduler)` (`@daily` → `"0 3 * * *"` sunucu UTC'de 06:00 İstanbul; `asynq` cron alanı).

- [ ] **Step 1: DB store**

```go
// backend/internal/platform/entitlements/store.go
package entitlements

import (
	"context"
	"strconv"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
)

// DBStore reads plan values and counters with sqlc (queries/entitlements.sql).
type DBStore struct{ q *db.Queries }

func NewDBStore(q *db.Queries) *DBStore { return &DBStore{q: q} }

func (s *DBStore) Features(ctx context.Context, orgID int64) ([]Feature, error) {
	rows, err := s.q.GetEffectiveFeatures(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]Feature, 0, len(rows))
	for _, r := range rows {
		f := Feature{Key: r.Key, Kind: r.Kind, Period: r.Period, Enforcement: r.Enforcement,
			Limit: -1, TolerancePct: int(r.TolerancePct), WarnPct: int(r.WarnPct)}
		if r.ValueInt.Valid {
			f.Limit = r.ValueInt.Int64
		}
		if r.ValueBool.Valid {
			f.Enabled = r.ValueBool.Bool
		}
		// Enterprise override (F5) wins over the plan value.
		if r.CustomValue.Valid && r.CustomValue.String != "" {
			if f.Kind == KindToggle {
				f.Enabled = r.CustomValue.String == "true"
			} else if n, err := strconv.ParseInt(r.CustomValue.String, 10, 64); err == nil {
				f.Limit = n
			}
		}
		out = append(out, f)
	}
	return out, nil
}

func (s *DBStore) Usage(ctx context.Context, orgID int64, key, periodKey string) (int64, error) {
	return s.q.GetUsageCounter(ctx, db.GetUsageCounterParams{OrganizationID: orgID, FeatureKey: key, PeriodKey: periodKey})
}

func (s *DBStore) Consume(ctx context.Context, orgID int64, key, periodKey string, delta int64) (int64, error) {
	return s.q.ConsumeUsage(ctx, db.ConsumeUsageParams{OrganizationID: orgID, FeatureKey: key, PeriodKey: periodKey, Delta: delta})
}
```

Not: sqlc `custom_value`'yu `pgtype.Text`, `value_int`'i `pgtype.Int8`, `value_bool`'u `pgtype.Bool` üretir; alan adlarını `sqlc generate` çıktısına göre doğrula.

- [ ] **Step 2: Yeniden hesap**

```go
// backend/internal/platform/entitlements/recompute.go
package entitlements

import (
	"context"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Recomputer rebuilds counters from source tables (spec §12). storage.gb has
// no source table and is left to its running counter.
type Recomputer struct {
	q   *db.Queries
	now func() time.Time
	loc *time.Location
}

func NewRecomputer(q *db.Queries, svc *Service) *Recomputer {
	return &Recomputer{q: q, now: svc.now, loc: svc.loc}
}

func (r *Recomputer) RecomputeUsage(ctx context.Context, orgID int64) error {
	now := r.now().In(r.loc)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, r.loc)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, r.loc)
	ts := func(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

	daily, err := r.q.CountActiveJobsInRange(ctx, db.CountActiveJobsInRangeParams{OrganizationID: orgID, FromAt: ts(dayStart), ToAt: ts(dayStart.AddDate(0, 0, 1))})
	if err != nil {
		return err
	}
	monthly, err := r.q.CountActiveJobsInRange(ctx, db.CountActiveJobsInRangeParams{OrganizationID: orgID, FromAt: ts(monthStart), ToAt: ts(monthStart.AddDate(0, 1, 0))})
	if err != nil {
		return err
	}
	members, err := r.q.CountOrgMembers(ctx, orgID)
	if err != nil {
		return err
	}
	customers, err := r.q.CountOrgCustomers(ctx, orgID)
	if err != nil {
		return err
	}
	for _, c := range []struct {
		key, period string
		value       int64
	}{
		{"jobs.daily", PeriodDay, daily}, {"jobs.monthly", PeriodMonth, monthly},
		{"staff.count", PeriodTotal, members}, {"customers.count", PeriodTotal, customers},
	} {
		if err := r.q.SetUsageCounter(ctx, db.SetUsageCounterParams{OrganizationID: orgID, FeatureKey: c.key,
			PeriodKey: PeriodKeyAt(c.period, now), Value: c.value}); err != nil {
			return err
		}
	}
	return nil
}

// RecomputeAll runs RecomputeUsage for every organization (daily job).
func (r *Recomputer) RecomputeAll(ctx context.Context) (int, error) {
	ids, err := r.q.ListOrganizationIDs(ctx)
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := r.RecomputeUsage(ctx, id); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
```

- [ ] **Step 3: DB testi** (mevcut `DATABASE_URL` yoksa skip; kalıp: `quotes/usecase/db_test.go`)

```go
// backend/internal/platform/entitlements/store_db_test.go
package entitlements

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/database/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDBStoreAndRecompute(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := db.New(pool)
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:10]
	var orgID int64
	if err := pool.QueryRow(ctx, `INSERT INTO organizations (slug, name) VALUES ($1, 'Ent Test') RETURNING id`, "ent-"+suffix).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID) })
	// Trial subscription like the backfill does.
	if _, err := pool.Exec(ctx, `INSERT INTO billing_subscriptions (organization_id, plan_id, status, ends_at)
		SELECT $1, id, 'trial', NOW() + INTERVAL '14 days' FROM billing_plans WHERE code = 'trial'`, orgID); err != nil {
		t.Fatal(err)
	}
	// One active and one cancelled job today.
	var cust int64
	_ = pool.QueryRow(ctx, `INSERT INTO customers (organization_id, name) VALUES ($1, 'C') RETURNING id`, orgID).Scan(&cust)
	var veh int64
	_ = pool.QueryRow(ctx, `INSERT INTO customer_vehicles (organization_id, customer_id, plate, model_id) VALUES ($1, $2, '34E1', (SELECT id FROM vehicle_models LIMIT 1)) RETURNING id`, orgID, cust).Scan(&veh)
	for _, st := range []string{"in_progress", "cancelled"} {
		if _, err := pool.Exec(ctx, `INSERT INTO service_jobs (organization_id, customer_id, vehicle_id, customer_name, plate, status, total_amount, started_at)
			VALUES ($1, $2, $3, 'C', '34E1', $4, 0, NOW())`, orgID, cust, veh, st); err != nil {
			t.Fatal(err)
		}
	}

	store := NewDBStore(q)
	svc := New(store)
	feats, err := store.Features(ctx, orgID)
	if err != nil || len(feats) == 0 {
		t.Fatalf("features: %v %d", err, len(feats))
	}
	if err := NewRecomputer(q, svc).RecomputeUsage(ctx, orgID); err != nil {
		t.Fatal(err)
	}
	d, err := svc.Check(ctx, orgID, "jobs.daily", 1)
	if err != nil || d.Used != 1 || d.Limit != 10 {
		t.Fatalf("after recompute: %+v %v (cancelled job must not count)", d, err)
	}
	// Counter never drops below zero.
	if v, _ := store.Consume(ctx, orgID, "storage.gb", "total", -5); v != 0 {
		t.Fatalf("negative consume clamped, got %d", v)
	}
	// Trial: ai.enabled is off → ErrFeatureDisabled; module.contracts on.
	if _, err := svc.Check(ctx, orgID, "ai.enabled", 1); err != ErrFeatureDisabled {
		t.Fatalf("ai toggle: %v", err)
	}
	if on, _ := svc.Enabled(ctx, orgID, "module.contracts"); !on {
		t.Fatal("contracts must be enabled on trial")
	}
	// Undefined feature (jobs.monthly has no trial value) is unlimited.
	if d, err := svc.Check(ctx, orgID, "jobs.monthly", 1); err != nil || d.Defined {
		t.Fatalf("undefined: %+v %v", d, err)
	}
	_ = time.Now
}
```

Not: `service_jobs`/`customer_vehicles` zorunlu sütunları migration'a göre değişebilir; `\d service_jobs` ile doğrula ve INSERT'i uyarla (`vehicle_label`, `currency` gibi NOT NULL DEFAULT'suz sütun varsa değer ver).

- [ ] **Step 4: Testi çalıştır**

Run: `cd backend && set -a && . ../.env && set +a && DATABASE_URL="$DATABASE_URL" go test ./internal/platform/entitlements/ -run TestDBStoreAndRecompute -v`
Expected: PASS.

- [ ] **Step 5: Worker görevi**

```go
// backend/internal/queue/billing.go
package queue

import (
	"context"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

// TaskBillingRecompute rebuilds usage counters from source tables once a day
// (06:00 Europe/Istanbul; the scheduler runs in UTC).
const TaskBillingRecompute = "app:billing:recompute"

const billingRecomputeCron = "0 3 * * *"

type RecomputeUsageFunc func(ctx context.Context) (int, error)

func NewBillingRecomputeTask() *asynq.Task { return asynq.NewTask(TaskBillingRecompute, []byte("{}")) }

func (w *Worker) WithBillingRecompute(fn RecomputeUsageFunc) *Worker {
	w.mux.HandleFunc(TaskBillingRecompute, func(ctx context.Context, _ *asynq.Task) error {
		if fn == nil {
			return nil
		}
		n, err := fn(ctx)
		w.log.Info("billing_recompute", "organizations", n)
		return err
	})
	return w
}

func RegisterBillingRecomputeSchedule(scheduler *asynq.Scheduler) error {
	if _, err := scheduler.Register(billingRecomputeCron, NewBillingRecomputeTask(),
		asynq.Queue(QueueMaintenance), asynq.Unique(time.Hour), asynq.MaxRetry(0)); err != nil {
		return fmt.Errorf("queue: register billing recompute: %w", err)
	}
	return nil
}
```

`cmd/worker/main.go`: `.WithVehicleAlerts(vehicleAlertsSvc.Flush).` satırından sonra `.WithBillingRecompute(entitlements.NewRecomputer(queries, entitlements.New(entitlements.NewDBStore(queries))).RecomputeAll).`; `RegisterVehicleAlertsSchedule` bloğundan sonra aynı kalıpla `RegisterBillingRecomputeSchedule(scheduler)`. Import: `"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"`.

- [ ] **Step 6: Derle ve commit**

Run: `cd backend && go build ./... && go vet ./internal/platform/entitlements/ ./internal/queue/`

```bash
git add backend/internal/platform/entitlements backend/internal/queue/billing.go backend/cmd/worker/main.go
git commit -m "feat(entitlements): DB store, daily usage recompute and worker schedule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: HTTP katmanı — hata kodları ve `RequireFeature` middleware

**Files:**
- Modify: `backend/pkg/response/response.go`
- Create: `backend/internal/middleware/feature.go`, `backend/internal/middleware/feature_test.go`

**Interfaces:**
- Produces: `response.CodeLimitReached = "LIMIT_REACHED"`, `response.CodeFeatureDisabled = "FEATURE_DISABLED"`, `response.LimitReached(w, r, d entitlements.Decision)` (409, details), `middleware.RequireFeature(ent *entitlements.Service, key string) func(http.Handler) http.Handler` (403 FEATURE_DISABLED). `response` paketi `entitlements`'ı import etmemeli (pkg → internal yasak); bu yüzden `LimitReached` middleware paketinde yaşar: `middleware.WriteLimitReached(w, r, d)`.

- [ ] **Step 1: Kodları ekle** — `response.go` const bloğuna:

```go
	CodeLimitReached    = "LIMIT_REACHED"
	CodeFeatureDisabled = "FEATURE_DISABLED"
```

- [ ] **Step 2: Middleware testi**

```go
// backend/internal/middleware/feature_test.go
package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
)

type fakeStore struct{ feats []entitlements.Feature }

func (f fakeStore) Features(context.Context, int64) ([]entitlements.Feature, error) { return f.feats, nil }
func (fakeStore) Usage(context.Context, int64, string, string) (int64, error)     { return 0, nil }
func (fakeStore) Consume(context.Context, int64, string, string, int64) (int64, error) {
	return 0, nil
}

func TestRequireFeature(t *testing.T) {
	off := entitlements.New(fakeStore{feats: []entitlements.Feature{{Key: "module.contracts", Kind: entitlements.KindToggle, Enabled: false}}})
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	ctx := orgctx.WithScope(context.Background(), orgctx.Scope{InternalID: 7})
	req := httptest.NewRequest("GET", "/x", nil).WithContext(ctx)

	rec := httptest.NewRecorder()
	RequireFeature(off, "module.contracts")(ok).ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("disabled toggle must 403, got %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	RequireFeature(nil, "module.contracts")(ok).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("nil service must allow, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	RequireFeature(off, "module.quotes")(ok).ServeHTTP(rec, req) // undefined toggle → on
	if rec.Code != 200 {
		t.Fatalf("undefined toggle must allow, got %d", rec.Code)
	}
}
```

- [ ] **Step 3: Çalıştır, FAIL gör** — `cd backend && go test ./internal/middleware/ -run TestRequireFeature` → `undefined: RequireFeature`.

- [ ] **Step 4: Middleware'i yaz**

```go
// backend/internal/middleware/feature.go
package middleware

import (
	"net/http"

	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/entitlements"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/internal/platform/orgctx"
	"github.com/furkanmeclis/nextjs-go-boilerplate/backend/pkg/response"
)

// RequireFeature blocks a module the organization's plan turns off (spec §4).
// Runs after RequireOrganization. A nil service allows everything.
func RequireFeature(ent *entitlements.Service, key string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			scope, ok := orgctx.ScopeFrom(r.Context())
			if ok && ent != nil {
				on, err := ent.Enabled(r.Context(), scope.InternalID, key)
				if err != nil {
					response.InternalErr(w, r, err, "feature check failed")
					return
				}
				if !on {
					response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// WriteLimitReached renders a hard limit as 409 with the numbers the UI shows.
func WriteLimitReached(w http.ResponseWriter, r *http.Request, d entitlements.Decision) {
	response.ErrorWithDetails(w, r, http.StatusConflict, response.CodeLimitReached, "Plan limit reached", []response.Detail{
		{Field: "feature", Message: d.Key},
		{Field: "limit", Message: itoa(d.Limit)},
		{Field: "used", Message: itoa(d.Used)},
		{Field: "tolerance", Message: itoa(d.Tolerance)},
	})
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
```
(`"strconv"` import; `response.Detail` alan adlarını `pkg/response/response.go` içinden doğrula — `Field`/`Message` değilse uyarla. `response.InternalErr` mevcut: `grep -n "func InternalErr" backend/pkg/response/response.go`.)

- [ ] **Step 5: Test PASS, commit**

Run: `cd backend && go test ./internal/middleware/ -run TestRequireFeature -v`

```bash
git add backend/pkg/response/response.go backend/internal/middleware/feature.go backend/internal/middleware/feature_test.go
git commit -m "feat(billing): LIMIT_REACHED / FEATURE_DISABLED codes and RequireFeature middleware

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Kancalar — jobs, customers, staff, storage, messaging, ai, modül route'ları

**Files:**
- Modify: `backend/internal/modules/jobs/usecase/service.go` (Create, Cancel, Void), `backend/internal/modules/jobs/handler/handler.go` (writeError), `backend/internal/modules/customers/usecase/service.go` (+handler writeError), `backend/internal/modules/staff/usecase/service.go` (+handler), `backend/internal/modules/storage/usecase/service.go` (Upload, CompleteUpload, silme), `backend/internal/modules/messaging/usecase/outbound.go` (QueueSend), `backend/internal/modules/ai/usecase/chat.go` (PrepareMessage), `backend/internal/modules/{contracts,leads,quotes,reports}/routes.go`, `backend/internal/httpserver/server.go`

**Interfaces:**
- Consumes: `entitlements.Service.Check/Consume/Enabled`, `entitlements.LimitError`, `ErrFeatureDisabled`, `middleware.RequireFeature`, `middleware.WriteLimitReached`.
- Produces: her serviste `SetEntitlements(*entitlements.Service)`; route kayıt fonksiyonlarına `ent *entitlements.Service` parametresi (contracts, leads, quotes, reports).

Ortak kalıp (her modülde aynı):

```go
// struct alanı
ent *entitlements.Service
// setter
func (s *Service) SetEntitlements(e *entitlements.Service) { s.ent = e }
```

- [ ] **Step 1: jobs — Create öncesi kontrol, sonrası tüketim, iptalde iade**

`Create` içinde `vehicle, err := s.q.GetCustomerVehicleDetailByUUID(...)` satırından **önce**:

```go
	for _, key := range []string{"jobs.daily", "jobs.monthly"} {
		if _, err := s.ent.Check(ctx, orgID, key, 1); err != nil {
			return JobDetail{}, err // *entitlements.LimitError → 409
		}
	}
```
`tx.Commit` başarılı olduktan hemen sonra:
```go
	_ = s.ent.Consume(ctx, orgID, "jobs.daily", 1)
	_ = s.ent.Consume(ctx, orgID, "jobs.monthly", 1)
```
`Cancel` ve `Void` içinde commit sonrası, iş **bugün** açıldıysa günlük sayaçtan düş (aylık için ay kontrolü):
```go
	s.giveBackJob(ctx, orgID, row.StartedAt.Time)
```
```go
// giveBackJob returns a cancelled job's slot to today's / this month's counter.
func (s *Service) giveBackJob(ctx context.Context, orgID int64, startedAt time.Time) {
	loc, _ := time.LoadLocation("Europe/Istanbul")
	if loc == nil {
		loc = time.FixedZone("TRT", 3*60*60)
	}
	now, st := time.Now().In(loc), startedAt.In(loc)
	if now.Year() == st.Year() && now.YearDay() == st.YearDay() {
		_ = s.ent.Consume(ctx, orgID, "jobs.daily", -1)
	}
	if now.Year() == st.Year() && now.Month() == st.Month() {
		_ = s.ent.Consume(ctx, orgID, "jobs.monthly", -1)
	}
}
```
`handler.go` `writeError` başına:
```go
	var le *entitlements.LimitError
	if errors.As(err, &le) {
		middleware.WriteLimitReached(w, r, le.Decision)
		return
	}
	if errors.Is(err, entitlements.ErrFeatureDisabled) {
		response.Error(w, r, http.StatusForbidden, response.CodeFeatureDisabled, "This feature is not included in your plan")
		return
	}
```
Not: `quotes.Convert` işi `JobCreator` üzerinden `jobsSvc.Create` ile açar; kanca otomatik kapsar. Quotes handler'ının `writeError`'ına da aynı iki dal eklenir.

- [ ] **Step 2: customers — Create** (`tx, err := s.pool.Begin` öncesi `Check(ctx, orgID, "customers.count", 1)`; commit sonrası `Consume(+1)`; import sırasında toplu ekleme yapan `ApplyRow` varsa aynı kontrol). Handler writeError'a iki dal.

- [ ] **Step 3: staff — Create** (`GetUserByEmail` kontrolünden önce `Check(ctx, orgID, "staff.count", 1)`; commit sonrası `Consume(+1)`). Üye silme/pasifleştirme fonksiyonu varsa (`grep -n "DeleteOrganizationMember\|RemoveMember" staff/usecase/service.go`) orada `Consume(-1)`. Handler writeError'a iki dal.

- [ ] **Step 4: storage — Upload / CompleteUpload / silme.** `Actor`'da org yok; storage servisi org kapsamını `orgctx.ScopeFrom(ctx)` ile alır (tenant route'larında var, platform route'larında yok → scope yoksa kontrol atlanır):

```go
func (s *Service) checkStorage(ctx context.Context, size int64) error {
	scope, ok := orgctx.ScopeFrom(ctx)
	if !ok || s.ent == nil || size <= 0 {
		return nil
	}
	_, err := s.ent.Check(ctx, scope.InternalID, "storage.gb", gbCeil(size))
	return err
}
func (s *Service) consumeStorage(ctx context.Context, delta int64) {
	if scope, ok := orgctx.ScopeFrom(ctx); ok && delta != 0 {
		_ = s.ent.Consume(ctx, scope.InternalID, "storage.gb", delta)
	}
}
// gbCeil: bytes → whole GB, at least 1 for any non-empty file? No — counters are in
// megabytes for precision: key stays "storage.gb" but counter stores MB; UI divides by 1024.
```
Karar: sayaç **MB** tutar (`value = bytes/1024/1024`, en az 1), limit değeri GB ise `Check` öncesi limit×1024 ile karşılaştırma gerekir → bunun yerine `storage.gb` özelliğini plan tarafında GB girilir, `DBStore.Features` bu anahtarda `Limit *= 1024` yapar (MB'a çevirir) ve UI `unit=GB` gösterirken `used/1024` böler. `Upload`: `checkStorage(ctx, meta.Size)` en başta, başarılı `store.Upload` sonrası `consumeStorage(ctx, mb(meta.Size))`. `CompleteUpload`: nesne boyutu okunuyorsa aynı. Silme fonksiyonunda (`Delete`/`Trash`) `consumeStorage(ctx, -mb(size))`. `mb(n) = max(1, n/1048576)`.

- [ ] **Step 5: messaging — QueueSend.** Kanal WhatsApp ise `req.OrgID` ile: `Enabled(ctx, req.OrgID, "whatsapp.enabled")` false → `fmt.Errorf("%w: whatsapp is not included in the plan", ErrInvalidRequest)` yerine `entitlements.ErrFeatureDisabled` döndür; ardından `Check(ctx, req.OrgID, "whatsapp.monthly", 1)`; kuyruğa yazdıktan sonra `Consume(+1)`. Messaging handler writeError'a iki dal (403/409). Not: notifycenter üzerinden giden sistem mesajları da buradan geçer; kapalı planda müşteri bildirimi gitmez — beklenen davranış (spec §4).

- [ ] **Step 6: ai — PrepareMessage.** `principalScope` sonrası: `Enabled(ctx, scope.InternalID, "ai.enabled")` false → `ErrFeatureDisabled`; `Check(ctx, scope.InternalID, "ai.monthly", 1)`; turn kaydı oluşturulduktan sonra `Consume(+1)`. AI handler'ının hata eşlemesine iki dal.

- [ ] **Step 7: Modül anahtarları (route middleware).** `contracts/routes.go` tenant zincirlerine `middleware.RequireFeature(ent, "module.contracts")` (platform preset route'larına değil); `leads/routes.go` ve `quotes/routes.go` tüm tenant zincirlerine `"module.quotes"` (quotes'un `/v1/public/quotes/*` route'ları hariç); `reports/routes.go` tüm route'lara `"module.reports"`; ayrıca `exports/routes.go` tenant export uçlarına `"module.reports"`. `RegisterRoutes` imzalarına `ent *entitlements.Service` eklenir; `server.go` çağrıları güncellenir.

- [ ] **Step 8: server.go bağlantısı.** `jobsSvc := ...` satırından önce:
```go
	entitlementsSvc := entitlements.New(entitlements.NewDBStore(deps.Queries))
```
ve `jobsSvc.SetEntitlements(entitlementsSvc)`, `customersSvc.SetEntitlements(...)`, `staffSvc.SetEntitlements(...)`, `storageSvc`(adını `grep -n "storageusecase.New" server.go` ile bul)`.SetEntitlements(...)`, `messagingSvc.SetEntitlements(...)`, `aiSvc.SetEntitlements(...)`; route kayıtlarına `entitlementsSvc` geç. Worker'daki `messagingSvc` için de `SetEntitlements(entitlements.New(entitlements.NewDBStore(queries)))` (WhatsApp sweep worker'da).

- [ ] **Step 9: Mevcut testler + derleme**

Run: `cd backend && go build ./... && go vet ./internal/modules/... && go test ./internal/modules/jobs/... ./internal/modules/customers/... ./internal/modules/staff/... ./internal/modules/messaging/... ./internal/modules/ai/... ./internal/modules/quotes/...`
Expected: PASS (nil entitlements = izin).

- [ ] **Step 10: Kanca DB testi** — `backend/internal/modules/jobs/usecase/entitlements_db_test.go`: `DATABASE_URL` ile; deneme aboneliği olan org'da `jobs.daily` değerini 1'e çeken `UPDATE billing_plan_features` sonrası ikinci `Create` çağrısının `errors.Is(err, entitlements.ErrLimitReached)` döndürdüğünü, `Cancel` sonrası tekrar açılabildiğini doğrular (fixture kalıbı: `quotes/usecase/db_test.go` `setup`). Tolerans testi: `tolerance_pct=100` iken 2. iş geçer, 3. iş 409.

- [ ] **Step 11: Commit**

```bash
git add backend/internal backend/cmd
git commit -m "feat(billing): enforce plan limits in jobs, customers, staff, storage, WhatsApp, AI and module routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `modules/billing` — use case (planlar, özellikler, abonelik, overview, deneme başlatma)

**Files:**
- Create: `backend/internal/modules/billing/usecase/{types.go,service.go,plans.go,subscriptions.go,overview.go,service_db_test.go}`
- Modify: `backend/internal/modules/organizations/usecase/service.go` (deneme aboneliği), `backend/internal/httpserver/server.go`

**Interfaces:**
- Produces:
```go
package usecase // billing
var ErrNotFound, ErrInvalidRequest, ErrConflict error
type Service struct{...}; func New(pool *pgxpool.Pool, q *db.Queries, act *activity.Recorder, ent *entitlements.Service) *Service
func (s *Service) EnsureBuiltinFeatures(ctx) error         // boot: sqlc UpsertBuiltinFeature ×12
func (s *Service) ListFeatures(ctx, includeInactive bool) ([]Feature, error)
func (s *Service) CreateDisplayFeature(ctx, in DisplayFeatureInput) (Feature, error)
func (s *Service) SetFeatureActive(ctx, id int64, active bool) error
func (s *Service) ListPlans(ctx, publicOnly bool) ([]Plan, error)      // Plan.Features doludur
func (s *Service) GetPlan(ctx, id uuid.UUID) (Plan, error)
func (s *Service) CreatePlan(ctx, in PlanInput) (Plan, error)
func (s *Service) UpdatePlan(ctx, id uuid.UUID, in PlanInput) (Plan, error)
func (s *Service) DeletePlan(ctx, id uuid.UUID) error                   // canlı abonelik varsa ErrConflict
func (s *Service) StartTrialTx(ctx, qtx *db.Queries, orgID int64, now time.Time) (time.Time, error) // ends_at döner
func (s *Service) Overview(ctx) (Overview, error)                       // tenant: orgctx zorunlu
func YearlyPrice(p Plan) string                                         // spec #12 kuralı
```
Tipler (`types.go`):
```go
type Feature struct { ID int64 `json:"id"`; Key string `json:"key"`; Kind string `json:"kind"`; Unit string `json:"unit"`; Period string `json:"period"`; LabelTR string `json:"label_tr"`; LabelEN string `json:"label_en"`; SortOrder int32 `json:"sort_order"`; IsBuiltin bool `json:"is_builtin"`; IsActive bool `json:"is_active"` }
type DisplayFeatureInput struct { Key, LabelTR, LabelEN string; SortOrder int32 }
type PlanFeatureValue struct { Key string `json:"key"`; ValueInt *int64 `json:"value_int"`; ValueBool *bool `json:"value_bool"`; DisplayText string `json:"display_text"`; Enforcement string `json:"enforcement"`; TolerancePct int32 `json:"tolerance_pct"`; WarnPct int32 `json:"warn_pct"`; MinValue,MaxValue,Step *int64; UnitPrice *string }
type Plan struct { UUID uuid.UUID `json:"uuid"`; Code, Name, Description string; PriceMonthly string `json:"price_monthly"`; YearlyPricing string `json:"yearly_pricing"`; PriceYearly string `json:"price_yearly"`; YearlyDiscountValue string `json:"yearly_discount_value"`; EffectiveYearly string `json:"effective_yearly"`; Currency string; TrialDays int32 `json:"trial_days"`; IsPublic, IsCustomizable, IsActive bool; Badge string; SortOrder int32; Features []PlanFeatureValue `json:"features"`; LiveSubscriptions int64 `json:"live_subscriptions"` }
type PlanInput struct { Code, Name, Description string; PriceMonthly string; YearlyPricing string; PriceYearly, YearlyDiscountValue string; TrialDays int32; IsPublic, IsCustomizable, IsActive bool; Badge string; SortOrder int32; Features []PlanFeatureValue }
type UsageMeter struct { Key string `json:"key"`; Kind string; Unit, Period, PeriodKey string; Limit *int64 `json:"limit"`; Used int64 `json:"used"`; WarnPct, TolerancePct int32; Enforcement string; Enabled *bool `json:"enabled"`; LabelTR, LabelEN string }
type Overview struct { Subscription *SubscriptionView `json:"subscription"`; Plan *Plan `json:"plan"`; Meters []UsageMeter `json:"meters"` }
type SubscriptionView struct { UUID uuid.UUID; PlanCode, PlanName, Period, Status string; StartsAt, EndsAt time.Time; GraceEndsAt *time.Time; DaysLeft int; CreditBalance string; Source string }
```

- [ ] **Step 1: `YearlyPrice` birim testi** (`service_test.go`, DB'siz):

```go
func TestYearlyPrice(t *testing.T) {
	cases := []struct{ p Plan; want string }{
		{Plan{PriceMonthly: "100.00", YearlyPricing: "fixed", PriceYearly: "1000.00"}, "1000.00"},
		{Plan{PriceMonthly: "100.00", YearlyPricing: "discount_amount", YearlyDiscountValue: "150"}, "1050.00"},
		{Plan{PriceMonthly: "100.00", YearlyPricing: "discount_percent", YearlyDiscountValue: "10"}, "1080.00"},
		{Plan{PriceMonthly: "100.00", YearlyPricing: "discount_amount", YearlyDiscountValue: "5000"}, "0.00"},
	}
	for _, c := range cases {
		if got := YearlyPrice(c.p); got != c.want {
			t.Errorf("%+v: got %s want %s", c.p, got, c.want)
		}
	}
}
```
Uygulama `math/big.Rat` ile: `fixed` → `price_yearly`; `discount_amount` → `12×monthly − X` (min 0); `discount_percent` → `12×monthly×(1−Y/100)`; `FloatString(2)`.

- [ ] **Step 2: Plan CRUD.** `CreatePlan`/`UpdatePlan` doğrulamaları: `code` `^[a-z0-9_-]{2,32}$`, fiyatlar `numeric` parse (`pgtype.Numeric.Scan`), `yearly_pricing` üç değerden biri, özellik anahtarları kataloğda ve aktif, `enforcement ∈ {hard,soft}`, pct 0–100, `kind=limit` için `value_int ≥ 0`, `toggle` için `value_bool`, `display` için `display_text`. Özellikler tek transaction'da `DeletePlanFeatures` + `InsertPlanFeature`. `DeletePlan`: `CountLiveSubscriptionsByPlan > 0` → `ErrConflict`; `trial` kodu silinemez. `ListPlans` her plan için `ListPlanFeatures` ve `CountLiveSubscriptionsByPlan` doldurur, `EffectiveYearly = YearlyPrice(p)`. Aktivite: `platform.billing.plan.create/update/delete`.

- [ ] **Step 3: `StartTrialTx`** — `GetBillingPlanByCode(ctx,"trial")`, `ends = now + trial_days`, `CreateSubscription(status trial, period monthly, source self_service, price 0)`, `SetOrganizationAccess(plan_code trial, starts now, ends)`; `ends` döner. `organizations/usecase/service.go`'daki iki kayıt yolunda (`Register` ~satır 195 ve admin oluşturma ~satır 265) `trialEnd := now.Add(trialDays * ...)` yerine, org oluşturulduktan sonra `s.billing.StartTrialTx(ctx, qtx, org.ID, now)` çağrılır; `CreateOrganization` parametrelerinden `PlanCode/AccessEndsAt` kaldırılmaz ama `StartTrialTx` bunları tekrar yazar. Organizations servisine `SetTrialStarter(TrialStarter)` seam'i: `type TrialStarter interface { StartTrialTx(ctx, qtx *db.Queries, orgID int64, now time.Time) (time.Time, error) }`; nil ise eski 14 gün davranışı (`trialDays` sabiti kalır). `server.go`: `orgSvc.SetTrialStarter(billingSvc)`.

- [ ] **Step 4: `Overview`** — `orgctx.MustScope`, `GetLiveSubscription` (yoksa `Subscription=nil`, `Meters=[]`), plan `GetPlan`, `ent.Snapshot` → `Meters` (features listesinden `Kind` limit/toggle; `storage.gb` için `Used/1024` ve limit GB'ye geri çevrilir; `Limit=-1` → `nil`), `DaysLeft = ceil(ends − now)` İstanbul.

- [ ] **Step 5: DB testi** (`service_db_test.go`, `DATABASE_URL` yoksa skip): `CreatePlan("pro", monthly 1500, yearly discount_percent 10, jobs.daily 50 hard tol 10, module.quotes true)` → `ListPlans(false)` içinde `effective_yearly == "16200.00"` ve 2 feature; `UpdatePlan` ile `jobs.daily=60`; `DeletePlan("trial")` → `ErrConflict`; test org'una `StartTrialTx` → `GetLiveSubscription.status == "trial"`, `organizations.access_ends_at ≈ now+14d`; `Overview` → `Meters` içinde `jobs.daily limit 10 used 0`, `ai.enabled enabled=false`.

- [ ] **Step 6: server.go** — `billingSvc := billingusecase.New(deps.DB, deps.Queries, activityRec, entitlementsSvc)`; `if err := billingSvc.EnsureBuiltinFeatures(ctx); err != nil { log.Warn(...) }` (server kurulumunda `ctx` yoksa `context.Background()`); `orgSvc.SetTrialStarter(billingSvc)`.

- [ ] **Step 7: Test + commit**

Run: `cd backend && go build ./... && go test ./internal/modules/billing/... ./internal/modules/organizations/...`

```bash
git add backend/internal/modules/billing backend/internal/modules/organizations backend/internal/httpserver/server.go
git commit -m "feat(billing): plan / feature / subscription use case, trial via billing, tenant overview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `modules/billing` — handler, route'lar, OpenAPI

**Files:**
- Create: `backend/internal/modules/billing/handler/handler.go`, `backend/internal/modules/billing/routes.go`
- Modify: `backend/internal/httpserver/server.go`, `backend/docs/openapi.yaml`

**Interfaces:**
- Produces (route'lar, spec §10'un F1 alt kümesi):
  - `GET /v1/tenant/billing/overview` (`tenant.billing.read`) → `EnvelopeBillingOverview`
  - `GET /v1/tenant/billing/plans` (`tenant.billing.read`) → `EnvelopeBillingPlanList` (public planlar)
  - `GET /v1/platform/billing/features` (`platform.billing.read`), `POST /v1/platform/billing/features` (`platform.billing.write`, display), `PATCH /v1/platform/billing/features/{id}` (is_active)
  - `GET /v1/platform/billing/plans`, `POST /v1/platform/billing/plans`, `GET/PUT/DELETE /v1/platform/billing/plans/{uuid}` (`platform.billing.read` / `.write`)
- Şemalar: `BillingFeature`, `BillingPlanFeatureValue`, `BillingPlan`, `BillingPlanInput`, `BillingUsageMeter`, `BillingSubscription`, `BillingOverview` + `Envelope*` sarmalları (mevcut `EnvelopeLeadSummary` kalıbı).

- [ ] **Step 1: Handler** — `leads/handler/handler.go` kalıbı: `decode`, `writeError` (`ErrNotFound`→404, `ErrInvalidRequest`→400 `VALIDATION_ERROR`, `ErrConflict`→409 `CONFLICT`, diğer→`InternalErr`). `PlatformListPlans` `?include_inactive=true`'yu okur (`ListPlans(ctx, false)` her zaman tümünü döner; public filtre tenant tarafında `ListPlans(ctx, true)`).

- [ ] **Step 2: Routes** — `leads/routes.go` kalıbı; tenant zinciri `authn, requireOrg, RequirePermission(tenant.billing.read)`; platform zinciri `authn, RequirePermission(platform.billing.read|write)`.

- [ ] **Step 3: OpenAPI** — `/v1/tenant/leads/summary` bloğunun üstüne tenant billing path'leri, `/v1/platform/organizations:` bloğunun üstüne platform billing path'leri; şemalar `LeadSummary`'nin üstüne. `BillingPlanInput.features[].key` için `description: "billing_features.key"`. `operationId`: `getTenantBillingOverview`, `getTenantBillingPlans`, `listPlatformBillingFeatures`, `createPlatformBillingFeature`, `updatePlatformBillingFeature`, `listPlatformBillingPlans`, `createPlatformBillingPlan`, `getPlatformBillingPlan`, `updatePlatformBillingPlan`, `deletePlatformBillingPlan`.

- [ ] **Step 4: Lint + üretim**

Run: `cd backend && make openapi-lint && go build ./... && cd ../frontend && pnpm api:generate`
Expected: "Your API description is valid"; `src/generated/api.d.ts` içinde `BillingOverview`.

- [ ] **Step 5: Duman testi (yerel dev ayakta)** — Tarayıcıdan (veya `curl` + oturum) `GET /api/v1/tenant/billing/overview` → 200, `meters` içinde `jobs.daily`; `GET /api/v1/platform/billing/plans` → `trial` planı.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/modules/billing backend/internal/httpserver/server.go backend/docs/openapi.yaml frontend/src/generated/api.d.ts
git commit -m "feat(billing): tenant overview and platform plan/feature endpoints with OpenAPI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Frontend temel — izinler, route'lar, çeviri, servis, hook'lar, limit olayı

**Files:**
- Modify: `frontend/src/config/permissions.ts`, `frontend/src/config/routes.ts`, `frontend/src/lib/i18n/messages.ts`, `frontend/src/locales/{tr,en}/permissions.json`, `frontend/src/locales/{tr,en}/layout.json`, `frontend/src/lib/api/platform-request.ts`
- Create: `frontend/src/locales/{tr,en}/billing.json`, `frontend/src/features/billing/{types.ts,services/billing.service.ts,hooks/use-billing.ts,lib/limit-events.ts,index.ts}`, `frontend/src/features/platform-billing/{services/platform-billing.service.ts,hooks/use-platform-billing.ts,index.ts}`

**Interfaces:**
- Produces: `permissions.billing = { read, write }` (tenant), `permissions.platformBilling = { read, write, settings }`; `routes.tenant.settings.billing(slug)` → `/t/{slug}/settings/billing`; `routes.platform.billing = { root: "/platform/billing", plans: "/platform/billing/plans" }`; `billingService.overview()`, `.plans()`; `useBillingOverview(enabled)`, `useBillingAccess()`; `platformBillingService.{listFeatures,createFeature,setFeatureActive,listPlans,getPlan,createPlan,updatePlan,deletePlan}`; `usePlatformPlans()`, `usePlatformFeatures()`, `usePlatformPlanMutations()`; `limitEvents.subscribe(cb) / emit(detail)` — `platformRequest` `LIMIT_REACHED` veya `FEATURE_DISABLED` alınca `window.dispatchEvent(new CustomEvent("otopoly:limit", {detail:{code, feature, limit, used}}))`.

- [ ] **Step 1: permissions.ts** — `Permission` nesnesine 5 slug; gruplar:
```ts
  billing: { read: Permission.TenantBillingRead, write: Permission.TenantBillingWrite },
  platformBilling: { read: Permission.PlatformBillingRead, write: Permission.PlatformBillingWrite, settings: Permission.PlatformBillingSettings },
```
`permissions.json` (tr/en) `labels.*` 5 satır ("Abonelik bilgilerini görüntüle", "Aboneliği yönet", "Platform aboneliklerini görüntüle", "Platform aboneliklerini yönet", "Abonelik ayarlarını yönet").

- [ ] **Step 2: routes.ts** — `tenant.settings.billing`, `platform.billing.{root,plans}`.

- [ ] **Step 3: billing.json (tr/en)** — anahtar seti (tr):
```json
{
  "title": "Abonelik", "description": "Planınız, kullanım limitleriniz ve dönem bilgisi.",
  "current_plan": "Mevcut plan", "period.monthly": "Aylık", "period.yearly": "Yıllık",
  "status.trial": "Deneme", "status.active": "Aktif", "status.grace": "Ek süre", "status.read_only": "Salt okunur", "status.cancelled": "İptal",
  "ends_at": "Bitiş", "days_left": "{{days}} gün kaldı", "expired": "Süresi doldu",
  "usage.title": "Kullanım", "usage.unlimited": "Sınırsız", "usage.of": "{{used}} / {{limit}}",
  "usage.period.day": "bugün", "usage.period.month": "bu ay", "usage.period.total": "toplam",
  "usage.tolerance": "Tolerans: {{tolerance}}", "usage.soft": "Yumuşak limit",
  "features.title": "Plan özellikleri", "features.on": "Dahil", "features.off": "Dahil değil",
  "plans.title": "Planlar", "plans.per_month": "/ ay", "plans.per_year": "/ yıl", "plans.yearly_saving": "Yıllık alımda {{value}} indirim", "plans.current": "Mevcut planınız", "plans.coming_soon": "Satın alma yakında",
  "limit.title": "Plan limitine ulaştınız", "limit.body": "{{feature}} limiti {{limit}}; kullanılan {{used}}. Devam etmek için planınızı yükseltin.", "limit.feature_disabled": "Bu özellik planınızda yok.", "limit.upgrade": "Planı yükselt", "limit.close": "Kapat",
  "locked.title": "Bu özellik planınızda yok", "locked.body": "Kullanmak için planınızı yükseltin.",
  "meter.jobs_daily": "Günlük işlem", "meter.staff": "Personel", "meter.customers": "Müşteri",
  "admin.title": "Abonelik", "admin.plans": "Planlar", "admin.features": "Özellikler",
  "admin.plan.new": "Yeni plan", "admin.plan.edit": "Planı düzenle", "admin.plan.code": "Kod", "admin.plan.name": "Ad", "admin.plan.description": "Açıklama", "admin.plan.price_monthly": "Aylık fiyat (KDV dahil)", "admin.plan.yearly_pricing": "Yıllık fiyatlandırma", "admin.plan.yearly.fixed": "Sabit yıllık fiyat", "admin.plan.yearly.discount_amount": "Yıllıkta TL indirim", "admin.plan.yearly.discount_percent": "Yıllıkta % indirim", "admin.plan.price_yearly": "Yıllık fiyat", "admin.plan.yearly_discount_value": "İndirim değeri", "admin.plan.effective_yearly": "Hesaplanan yıllık", "admin.plan.trial_days": "Deneme günü", "admin.plan.is_public": "Fiyat sayfasında görünsün", "admin.plan.is_customizable": "Enterprise (işletme limit seçer)", "admin.plan.badge": "Rozet", "admin.plan.sort_order": "Sıra", "admin.plan.is_active": "Aktif",
  "admin.plan.features": "Özellik değerleri", "admin.plan.feature.value": "Değer", "admin.plan.feature.enforcement": "Uygulama", "admin.plan.feature.hard": "Sert", "admin.plan.feature.soft": "Yumuşak", "admin.plan.feature.tolerance": "Tolerans %", "admin.plan.feature.warn": "Uyarı %", "admin.plan.feature.undefined": "Tanımsız (sınırsız)", "admin.plan.feature.display_text": "Gösterim metni",
  "admin.plan.live": "{{count}} canlı abonelik", "admin.plan.delete": "Planı sil", "admin.plan.delete_confirm": "Bu plan silinsin mi? Canlı aboneliği olan plan silinemez.",
  "admin.feature.new": "Gösterim özelliği ekle", "admin.feature.key": "Anahtar", "admin.feature.label_tr": "Etiket (TR)", "admin.feature.label_en": "Etiket (EN)",
  "toast.plan_saved": "Plan kaydedildi.", "toast.plan_deleted": "Plan silindi.", "toast.feature_saved": "Özellik kaydedildi."
}
```
EN karşılıkları aynı anahtarlarla. `messages.ts`'e `billing` kaydı (tr/en). `layout.json`: `"nav_billing": "Abonelik"`, `"section_billing": "Abonelik"`, `"nav_billing_plans": "Planlar"` (tr) / "Subscription", "Subscription", "Plans" (en).

- [ ] **Step 4: types + service + hooks (tenant)**

```ts
// features/billing/types.ts
import type { components } from "@/generated/api";
type S = components["schemas"];
export type BillingOverview = S["BillingOverview"];
export type BillingPlan = S["BillingPlan"];
export type BillingUsageMeter = S["BillingUsageMeter"];
export type BillingSubscription = S["BillingSubscription"];
```
```ts
// features/billing/services/billing.service.ts
import { platformRequest } from "@/lib/api/platform-request";
import type { BillingOverview, BillingPlan } from "@/features/billing/types";
export const billingService = {
  overview() { return platformRequest<BillingOverview>("GET", "/v1/tenant/billing/overview"); },
  plans() { return platformRequest<BillingPlan[]>("GET", "/v1/tenant/billing/plans"); },
};
```
```ts
// features/billing/hooks/use-billing.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import { permissions } from "@/config/permissions";
import { billingService } from "@/features/billing/services/billing.service";
import { usePermission } from "@/providers/permission-provider";
export const billingKeys = {
  all: ["tenant", "billing"] as const,
  overview: () => [...billingKeys.all, "overview"] as const,
  plans: () => [...billingKeys.all, "plans"] as const,
};
export function useBillingAccess() {
  const { hasPermission } = usePermission();
  return { canRead: hasPermission(permissions.billing.read), canWrite: hasPermission(permissions.billing.write) };
}
export function useBillingOverview(enabled = true) {
  return useQuery({ queryKey: billingKeys.overview(), queryFn: () => billingService.overview(), enabled, refetchInterval: 60_000 });
}
export function useBillingPlans(enabled = true) {
  return useQuery({ queryKey: billingKeys.plans(), queryFn: () => billingService.plans(), enabled, staleTime: 5 * 60_000 });
}
```
Kancalarda sayaç değiştiğinde overview'ın tazelenmesi için `jobs`, `staff`, `customers` mutation `onSuccess`'lerine `qc.invalidateQueries({ queryKey: ["tenant","billing"] })` eklenir (Task 11'de).

- [ ] **Step 5: limit olayı**

```ts
// features/billing/lib/limit-events.ts
export type LimitEventDetail = { code: "LIMIT_REACHED" | "FEATURE_DISABLED"; feature?: string; limit?: number; used?: number; tolerance?: number };
const NAME = "otopoly:limit";
export function emitLimitEvent(detail: LimitEventDetail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<LimitEventDetail>(NAME, { detail }));
}
export function subscribeLimitEvents(cb: (d: LimitEventDetail) => void) {
  const h = (e: Event) => cb((e as CustomEvent<LimitEventDetail>).detail);
  window.addEventListener(NAME, h);
  return () => window.removeEventListener(NAME, h);
}
```
`platform-request.ts`: `ApiError` fırlatılmadan hemen önce (hata gövdesi parse edildikten sonra):
```ts
if (code === "LIMIT_REACHED" || code === "FEATURE_DISABLED") {
  const d = Object.fromEntries((details ?? []).map((x) => [x.field, x.message]));
  emitLimitEvent({ code, feature: d.feature, limit: Number(d.limit), used: Number(d.used), tolerance: Number(d.tolerance) });
}
```
(`code`/`details` değişken adlarını dosyadaki gerçek adlara göre uyarla; `errors.ts`'deki `ApiErrorDetail` alanları `field`/`message`.)

- [ ] **Step 6: platform-billing service + hooks** — `platformBillingService` (`/v1/platform/billing/*`), `usePlatformPlans`, `usePlatformFeatures`, `usePlatformPlanMutations` (`create/update/remove` + toast + invalidate `["platform","billing"]`), `usePlatformFeatureMutations` (`create`, `setActive`).

- [ ] **Step 7: Typecheck + commit**

Run: `cd frontend && pnpm exec tsc --noEmit -p . && pnpm exec eslint src/features/billing src/features/platform-billing src/lib/api`

```bash
git add frontend/src
git commit -m "feat(billing): permissions, routes, locales, services, hooks and limit events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: İşletme "Abonelik" sayfası, `UsageMeter`, `LimitReachedDialog`, `FeatureLocked`

**Files:**
- Create: `frontend/src/features/billing/components/{usage-meter.tsx,subscription-page.tsx,limit-reached-dialog.tsx,feature-locked.tsx}`, `frontend/src/app/(tenant)/t/[slug]/settings/billing/page.tsx`
- Modify: `frontend/src/config/nav.ts` (tenant `settings` grubuna "Abonelik" öğesi, `permission: permissions.billing.read`), `frontend/src/app/(tenant)/t/[slug]/layout.tsx` (`<LimitReachedDialog slug={slug} />` AppLayout içine), `features/billing/index.ts`

**Interfaces:**
- Produces:
```tsx
<UsageMeter meter={BillingUsageMeter} compact?: boolean />   // renk: <warn gri/primary, ≥warn amber, ≥limit rose; tolerans bölgesi çizgili
<SubscriptionPage slug={string} />
<LimitReachedDialog slug={string} />                          // subscribeLimitEvents ile açılır; "Planı yükselt" → routes.tenant.settings.billing
<FeatureLocked slug={string} feature={string} />              // 403 FEATURE_DISABLED alan sayfalarda gösterilecek kart
```

- [ ] **Step 1: `UsageMeter`**

```tsx
"use client";
import { Progress } from "@/components/ui/progress";
import type { BillingUsageMeter } from "@/features/billing/types";
import { formatQuantity } from "@/features/finance/lib/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export function meterTone(m: BillingUsageMeter): "ok" | "warn" | "over" {
  if (m.limit == null || m.limit < 0) return "ok";
  if (m.used >= m.limit) return "over";
  if (m.used * 100 >= m.limit * m.warn_pct) return "warn";
  return "ok";
}

export function UsageMeter({ meter, compact = false }: { meter: BillingUsageMeter; compact?: boolean }) {
  const { t, locale } = useLocale();
  const label = locale === "tr" ? meter.label_tr : meter.label_en;
  const unlimited = meter.limit == null || meter.limit < 0;
  const tone = meterTone(meter);
  const pct = unlimited ? 0 : Math.min(100, Math.round((meter.used / Math.max(1, meter.limit!)) * 100));
  const tolerance = unlimited ? 0 : Math.round(meter.limit! * (1 + meter.tolerance_pct / 100));
  const bar = tone === "over" ? "[&>[data-slot=progress-indicator]]:bg-rose-500" : tone === "warn" ? "[&>[data-slot=progress-indicator]]:bg-amber-500" : "";
  return (
    <div className={cn("space-y-1", compact ? "min-w-40" : "")}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={cn("truncate", compact ? "text-muted-foreground" : "font-medium")}>{label}</span>
        <span className={cn("tabular-nums", tone === "over" && "text-rose-600 dark:text-rose-400", tone === "warn" && "text-amber-600 dark:text-amber-400")}>
          {unlimited ? t("billing.usage.unlimited") : t("billing.usage.of", { used: formatQuantity(meter.used, locale), limit: formatQuantity(meter.limit!, locale) })}
          {!compact && meter.period !== "total" ? ` · ${t(`billing.usage.period.${meter.period}`)}` : ""}
        </span>
      </div>
      {!unlimited ? <Progress value={pct} className={cn("h-1.5", bar)} aria-label={label} /> : null}
      {!compact && !unlimited && meter.tolerance_pct > 0 ? (
        <p className="text-muted-foreground text-[11px]">{t("billing.usage.tolerance", { tolerance: formatQuantity(tolerance, locale) })}{meter.enforcement === "soft" ? ` · ${t("billing.usage.soft")}` : ""}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: `SubscriptionPage`** — `EntityPage` (title `billing.title`, breadcrumbs: home → settings → billing). İçerik: üstte plan kartı (`EntitySectionCard`: plan adı + `StatusChip` durum, dönem, bitiş tarihi ve `days_left`, deneme ise "Deneme" rozeti); "Kullanım" kartı: `meters.filter(kind==='limit')` grid'inde `UsageMeter`; "Plan özellikleri" kartı: toggle'lar `Dahil/Dahil değil` chip'leri + display özellikleri; en altta "Planlar" kartı: `useBillingPlans` ile public planlar, aylık/yıllık `Tabs` anahtarı, her plan kartında fiyat (`formatFinanceAmount`), `effective_yearly`, `plans.yearly_saving` rozeti (yearly_pricing ≠ fixed), özellik listesi, mevcut plana "Mevcut planınız", diğerlerine pasif "Satın alma yakında" butonu (F2'de değişecek). `canRead` yoksa `ErrorState`.

- [ ] **Step 3: `LimitReachedDialog`** — `useEffect` ile `subscribeLimitEvents`; `Dialog` başlığı `limit.title` (FEATURE_DISABLED ise `locked.title`), gövde `limit.body` (feature etiketi için overview'daki meter `label_*`'ı bul; yoksa anahtar), butonlar `limit.close` ve `limit.upgrade` (`router.push(routes.tenant.settings.billing(slug))`). Tenant layout'ta `AppLayout` içine, `AssistantLauncher` yanına.

- [ ] **Step 4: `FeatureLocked`** — `EmptyState` benzeri kart: kilit ikonu, `locked.title`, `locked.body`, "Planı yükselt" linki. Kullanım: contracts, leads, quotes, reports sayfalarının liste bileşenlerinde `useQuery` `isError && error.code === "FEATURE_DISABLED"` ise `<FeatureLocked/>` render et (4 sayfada küçük ekleme: `features/contracts/components/contracts-page.tsx`, `leads-page.tsx`, `quotes-page.tsx`, `reports-page.tsx`; dosya adlarını `ls` ile doğrula).

- [ ] **Step 5: Sayfa ve nav** — `settings/billing/page.tsx` (`useParams` → `<SubscriptionPage slug/>`); `nav.ts` tenant `settings` grubuna `{ id: "billing", titleKey: "layout.nav_billing", href: routes.tenant.settings.billing(slug), icon: CreditCard, permission: permissions.billing.read }` (`CreditCard` lucide import).

- [ ] **Step 6: Doğrula** — `pnpm exec tsc --noEmit -p . && pnpm exec eslint src/features/billing src/config src/app`; tarayıcıda `/t/techoto/settings/billing`: deneme planı, `Günlük işlem 0 / 10`, AI "Dahil değil"; İşlemler'de 11. işi API ile açmayı dene (`jobs.daily` limiti 10) → `LimitReachedDialog` görünür.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(billing): tenant subscription page, usage meters, limit dialog and feature lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Sayaçların mevcut sayfalara yerleşimi + overview tazeleme

**Files:**
- Modify: `frontend/src/features/jobs/components/jobs-page.tsx` (üst çubuk `DaySummaryBar` yanına `jobs.daily` `UsageMeter compact`), `frontend/src/features/staff/components/staff-page.tsx` (`staff.count`), `frontend/src/features/customers/components/customers-page.tsx` (`customers.count`), `frontend/src/features/jobs/hooks/use-jobs.ts`, `frontend/src/features/staff/hooks/use-staff.ts`, `frontend/src/features/customers/hooks/use-customers.ts` (mutation `onSuccess` → `invalidateQueries({queryKey: ["tenant","billing"]})`)

- [ ] **Step 1:** Ortak yardımcı `features/billing/components/meter-for.tsx`: `<MeterFor keyName="jobs.daily" compact />` — `useBillingAccess().canRead && useBillingOverview()` ile meter'ı bulur, yoksa `null`. Üç sayfaya yerleştir (İşlemler: tarih/özet çubuğunun sağ ucu; Personel ve Müşteriler: `EntityPage` `actions` alanına, "Yeni" butonunun soluna).
- [ ] **Step 2:** Üç hook'ta `create`/`cancel`/`voidJob` (jobs), `create`/`remove` (staff), `create` (customers) `onSuccess` sonuna billing invalidasyonu.
- [ ] **Step 3:** Doğrula (tsc, eslint) ve tarayıcıda İşlemler'de yeni iş açınca sayacın 1 arttığını gör; commit:

```bash
git add frontend/src
git commit -m "feat(billing): usage meters on operations, staff and customers pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Admin plan yönetimi (Platform → Abonelik → Planlar)

**Files:**
- Create: `frontend/src/features/platform-billing/components/{plans-page.tsx,plan-dialog.tsx,plan-features-editor.tsx,features-dialog.tsx}`, `frontend/src/app/(platform)/platform/billing/plans/page.tsx`, `frontend/src/features/platform-billing/index.ts`
- Modify: `frontend/src/config/nav.ts` (platform nav'a `billing` grubu: `section_billing` → `Planlar`, `permission: permissions.platformBilling.read`, icon `CreditCard`)

- [ ] **Step 1: `PlansPage`** — `EntityPage` (title `billing.admin.plans`), `actions`: "Yeni plan" (`canWrite`) ve "Gösterim özelliği ekle". Kart grid: her plan → ad, kod, rozet, aylık fiyat, `effective_yearly`, `is_public/is_active/is_customizable` chip'leri, `admin.plan.live` sayısı, özellik özeti (ilk 4), "Düzenle" / "Sil" (live>0 ise disabled + tooltip). Trial planı silinemez.

- [ ] **Step 2: `PlanDialog`** — `AppForm` + zod: `code` (`/^[a-z0-9_-]{2,32}$/`, düzenlemede readOnly), `name`, `description`, `price_monthly` (`AppInput type=number step=any`), `yearly_pricing` (`AppSelect` 3 seçenek), `yearly_pricing==='fixed'` ise `price_yearly` yoksa `yearly_discount_value`; canlı "Hesaplanan yıllık" satırı (aynı formül client'ta: fixed→price_yearly; amount→12m−x; percent→12m×(1−y/100), min 0); `trial_days`, `badge`, `sort_order`, `is_public`, `is_customizable`, `is_active` (`AppSwitch`). Altında `PlanFeaturesEditor`.

- [ ] **Step 3: `PlanFeaturesEditor`** — `usePlatformFeatures()` kataloğunu satır satır listeler: limit türü için "Tanımsız" `AppSwitch` + `value_int` sayı, `enforcement` select (hard/soft), `tolerance_pct`, `warn_pct`; toggle için `AppSwitch`; display için `display_text`. Form değeri `features: PlanFeatureValue[]` (tanımsız satırlar gönderilmez).

- [ ] **Step 4: `FeaturesDialog`** — gösterim özelliği ekleme (`key`, `label_tr`, `label_en`, `sort_order`) + mevcut display özellikleri için aktif/pasif anahtarı.

- [ ] **Step 5: Sayfa + nav + index** — `platform/billing/plans/page.tsx` → `<PlansPage/>`; nav grubu.

- [ ] **Step 6: Doğrula** — tsc/eslint; tarayıcıda `/platform/billing/plans`: "Deneme" kartı; "Yeni plan" ile `pro` (aylık 1500, yıllık %10, `jobs.daily 50` sert tol 10, `ai.enabled` açık) oluştur → kart `16.200,00 ₺ / yıl`; düzenleyip `jobs.daily 60` yap; `trial` silme butonu pasif.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(billing): platform plan management with feature value editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Uçtan uca doğrulama ve belge

**Files:**
- Modify: `docs/ARCHITECTURE.md` (kısa "Billing & entitlements" bölümü: modül, entitlements seam, kancalar, sayaç yeniden hesabı), `backend/API_CONVENTIONS.md` (`LIMIT_REACHED` / `FEATURE_DISABLED` hata kodları)

- [ ] **Step 1: Backend tam test** — `cd backend && set -a && . ../.env && set +a && DATABASE_URL="$DATABASE_URL" go test ./... 2>&1 | grep -v "^ok\|no test files"` → boş çıktı.
- [ ] **Step 2: Frontend** — `pnpm exec tsc --noEmit -p . && pnpm exec eslint src` temiz; `next build` (ayrı worktree'de, önceki oturumdaki yöntem) başarılı.
- [ ] **Step 3: Senaryo (yerel, tarayıcı):** (a) yeni işletme kaydı → `billing_subscriptions`'da trial satırı ve Abonelik sayfasında 14 gün; (b) `jobs.daily` limiti 2 + tolerans %50 yapılmış test planında 3. iş geçer (Soft), 4. iş `LimitReachedDialog`; (c) trial'da AI sayfası → `FeatureLocked`; (d) admin planı `ai.enabled=true` yapınca AI açılır; (e) worker `RecomputeAll` çalıştırılıp sayaçların değişmediği (`billing_usage_counters`) görülür.
- [ ] **Step 4: Belgeler + commit**

```bash
git add docs/ARCHITECTURE.md backend/API_CONVENTIONS.md
git commit -m "docs(billing): entitlements seam, hooks and error codes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notu

- Spec §3 tabloları F1 kapsamındakiler (features, plans, plan_features, subscriptions, usage_counters) Task 1'de; `billing_orders/discount/invoices/settings` ve `organizations.invoice_*` F2–F3 planlarında.
- §4'teki 10 kanca: jobs (Task 6/1), staff (6/3), customers (6/2), storage (6/4), whatsapp (6/5), ai (6/6), module.* (6/7). Salt okunur mod F4.
- §10 F1 uçları Task 8; §11 tenant sayfası Task 10, sayaç yerleşimi Task 11, admin planlar Task 12.
- Tip tutarlılığı: `entitlements.Decision{Allowed,Soft,Defined,Key,Limit,Used,Tolerance,WarnAt}` Task 3–6'da aynı; `BillingUsageMeter{key,kind,unit,period,period_key,limit,used,warn_pct,tolerance_pct,enforcement,enabled,label_tr,label_en}` Task 7 → OpenAPI (Task 8) → `UsageMeter` (Task 10).
- Review Focus 1–5 için testler: Task 4 (iptal sayılmaz, İstanbul dönüm, negatif clamp), Task 3 (tanımsız = sınırsız), Task 1 Step 4 (backfill sayısı) + Task 4 testi trial status.
