/**
 * Plan & usage (settings area). Mobile only reads `GET /v1/tenant/billing/overview`; purchases,
 * orders and invoices are not part of the app, so they are not mocked.
 *
 * Plan limits are enforced here the way `internal/platform/entitlements` does on the Go API
 * (`409 LIMIT_REACHED` with `feature/limit/used/tolerance` details, `403 FEATURE_DISABLED`),
 * driven by the demo scenario picked on the diagnostics screen (see `../scenario.ts`).
 */
import type { BillingOverview, BillingPlan, BillingUsageMeter } from '@/features/billing/types';

import { fail, istanbulDay, requirePerm, route, type MockCtx } from '../core';
import { getDb } from '../db';
import { getPlanScenario, type PlanScenario } from '../scenario';

const DAY = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

type FeatureDef = {
  key: string;
  kind: 'limit' | 'toggle';
  period: 'day' | 'month' | 'total' | 'none';
  unit: string;
  label_tr: string;
  label_en: string;
  /** Limit (null = unlimited) or toggle value. */
  value: number | null | boolean;
};

/** Same keys and labels as the backend's `billing_features` seed (migration 000064). */
const FEATURES: FeatureDef[] = [
  { key: 'jobs.daily', kind: 'limit', period: 'day', unit: 'adet', label_tr: 'Günlük işlem', label_en: 'Daily jobs', value: 60 },
  { key: 'jobs.monthly', kind: 'limit', period: 'month', unit: 'adet', label_tr: 'Aylık işlem', label_en: 'Monthly jobs', value: null },
  { key: 'staff.count', kind: 'limit', period: 'total', unit: 'kişi', label_tr: 'Personel sayısı', label_en: 'Staff members', value: 10 },
  { key: 'customers.count', kind: 'limit', period: 'total', unit: 'adet', label_tr: 'Müşteri kaydı', label_en: 'Customer records', value: 2500 },
  { key: 'storage.gb', kind: 'limit', period: 'total', unit: 'GB', label_tr: 'Depolama alanı', label_en: 'Storage', value: 10 },
  { key: 'whatsapp.enabled', kind: 'toggle', period: 'none', unit: '', label_tr: 'WhatsApp mesajlaşma', label_en: 'WhatsApp messaging', value: true },
  { key: 'whatsapp.monthly', kind: 'limit', period: 'month', unit: 'mesaj', label_tr: 'Aylık WhatsApp mesajı', label_en: 'Monthly WhatsApp messages', value: 1000 },
  { key: 'ai.enabled', kind: 'toggle', period: 'none', unit: '', label_tr: 'Yapay zekâ asistanı', label_en: 'AI assistant', value: true },
  { key: 'ai.monthly', kind: 'limit', period: 'month', unit: 'istek', label_tr: 'Aylık AI isteği', label_en: 'Monthly AI requests', value: 500 },
  { key: 'module.contracts', kind: 'toggle', period: 'none', unit: '', label_tr: 'Sözleşme modülü', label_en: 'Contracts module', value: true },
  { key: 'module.quotes', kind: 'toggle', period: 'none', unit: '', label_tr: 'Teklif ve fırsat modülü', label_en: 'Quotes & leads module', value: true },
  { key: 'module.reports', kind: 'toggle', period: 'none', unit: '', label_tr: 'Raporlar ve dışa aktarım', label_en: 'Reports & exports', value: true },
  // Migration 000093.
  { key: 'loyalty.enabled', kind: 'toggle', period: 'none', unit: '', label_tr: 'Sadakat ve paketler', label_en: 'Loyalty & packages', value: true },
];

/** Modules each scenario turns off (each has the shared lock state in the app). */
const DISABLED_IN_SCENARIO: Partial<Record<PlanScenario, Set<string>>> = {
  feature_disabled: new Set(['module.contracts', 'module.reports', 'ai.enabled', 'loyalty.enabled']),
  quotes_disabled: new Set(['module.quotes']),
};

const PLAN: BillingPlan = {
  uuid: 'b111a000-0000-4000-8000-000000000002',
  code: 'pro',
  name: 'Profesyonel',
  description: 'Büyüyen oto yıkama ve detaylandırma işletmeleri için.',
  // Prices exist on the API schema but the app never shows them.
  price_monthly: '0.00',
  yearly_pricing: 'fixed',
  price_yearly: '0.00',
  yearly_discount_value: '0',
  effective_yearly: '0.00',
  currency: 'TRY',
  trial_days: 0,
  is_public: true,
  is_customizable: false,
  is_active: true,
  badge: '',
  sort_order: 2,
  live_subscriptions: 0,
  features: FEATURES.map((f) => ({
    key: f.key,
    value_int: typeof f.value === 'number' ? f.value : null,
    value_bool: typeof f.value === 'boolean' ? f.value : null,
    display_text: '',
    enforcement: 'hard',
    tolerance_pct: 0,
    warn_pct: 80,
    min_value: null,
    max_value: null,
    step: null,
    kind: f.kind,
    unit: f.unit,
    label_tr: f.label_tr,
    label_en: f.label_en,
    unit_price: null,
  })),
};

function enabled(key: string, scenario: PlanScenario = getPlanScenario()) {
  const f = FEATURES.find((x) => x.key === key);
  if (!f || f.kind !== 'toggle') return true;
  if (DISABLED_IN_SCENARIO[scenario]?.has(key)) return false;
  return f.value !== false;
}

/** Current usage per limit key: real counts from the demo DB, pushed up by the scenario. */
function usage(ctx: MockCtx, scenario: PlanScenario = getPlanScenario()): Record<string, number> {
  const db = getDb();
  const today = istanbulDay();
  const month = today.slice(0, 7);
  const orgJobs = db.jobs.filter((j) => j._org === ctx.orgUuid && j.status !== 'cancelled' && j.status !== 'voided');
  const real: Record<string, number> = {
    'jobs.daily': orgJobs.filter((j) => istanbulDay(j.started_at) === today).length,
    'jobs.monthly': orgJobs.filter((j) => istanbulDay(j.started_at).slice(0, 7) === month).length,
    'staff.count': db.memberships.filter((m) => m.orgUuid === ctx.orgUuid).length,
    'customers.count': db.customers.length,
    'storage.gb': 2,
    'whatsapp.monthly': 312,
    'ai.monthly': 118,
  };
  const limitOf = (key: string) => FEATURES.find((f) => f.key === key)?.value as number;
  // near: ≥ 80 % of the limit; at: exactly the limit.
  const push = (keys: string[], share: number) => {
    for (const k of keys) real[k] = Math.max(real[k], Math.ceil(limitOf(k) * share));
  };
  if (scenario === 'near_limit') {
    push(['jobs.daily', 'customers.count', 'whatsapp.monthly'], 0.85);
    push(['staff.count'], 0.8);
  }
  if (scenario === 'at_limit') {
    for (const k of ['jobs.daily', 'customers.count', 'staff.count', 'whatsapp.monthly']) real[k] = limitOf(k);
  }
  return real;
}

function meters(ctx: MockCtx): BillingUsageMeter[] {
  const used = usage(ctx);
  const today = istanbulDay();
  return FEATURES.map((f) => ({
    key: f.key,
    kind: f.kind,
    unit: f.unit,
    period: f.period,
    period_key: f.period === 'day' ? today : f.period === 'month' ? today.slice(0, 7) : '',
    limit: f.kind === 'limit' ? (f.value as number | null) : null,
    used: f.kind === 'limit' ? (used[f.key] ?? 0) : 0,
    warn_pct: 80,
    tolerance_pct: 0,
    enforcement: 'hard',
    enabled: f.kind === 'toggle' ? enabled(f.key) : null,
    label_tr: f.label_tr,
    label_en: f.label_en,
  }));
}

// ─── Enforcement (called by the mock transport before every tenant handler) ──

/** Write routes that consume a limited counter, with the permission the handler checks first. */
const LIMITED_WRITES: { method: string; pattern: RegExp; feature: string; perm: string }[] = [
  { method: 'POST', pattern: /^\/v1\/tenant\/jobs$/, feature: 'jobs.daily', perm: 'tenant.jobs.write' },
  { method: 'POST', pattern: /^\/v1\/tenant\/quotes\/[^/]+\/convert$/, feature: 'jobs.daily', perm: 'tenant.quotes.write' },
  { method: 'POST', pattern: /^\/v1\/tenant\/customers$/, feature: 'customers.count', perm: 'tenant.customers.write' },
  { method: 'POST', pattern: /^\/v1\/tenant\/staff$/, feature: 'staff.count', perm: 'tenant.staff.write' },
];

/** Route prefixes behind `middleware.RequireFeature`. The AI status route reports `plan_enabled` instead. */
const GATED_PREFIXES: { prefix: string; feature: string }[] = [
  { prefix: '/v1/tenant/contracts/', feature: 'module.contracts' },
  { prefix: '/v1/tenant/reports/', feature: 'module.reports' },
  { prefix: '/v1/tenant/ai/conversations', feature: 'ai.enabled' },
  { prefix: '/v1/tenant/ai/actions/', feature: 'ai.enabled' },
  // Quotes and leads share `module.quotes` (backend quotes/leads routes.go).
  { prefix: '/v1/tenant/quotes', feature: 'module.quotes' },
  { prefix: '/v1/tenant/leads', feature: 'module.quotes' },
  // Loyalty; the customer / job loyalty sections check the feature in their handlers.
  { prefix: '/v1/tenant/loyalty/', feature: 'loyalty.enabled' },
];

/** Writes still allowed in read-only mode (backend `readOnlyAllowed`). */
const readOnlyAllowed = (method: string, path: string) =>
  method === 'GET' || method === 'HEAD' || path.startsWith('/v1/tenant/billing/') || path.startsWith('/v1/tenant/exports/');

export function enforcePlan(ctx: MockCtx) {
  const scenario = getPlanScenario();
  if (scenario === 'normal' || scenario === 'near_limit') return;

  // Same message as the Go API; the app never shows it (it has its own neutral copy).
  if (scenario === 'read_only' && !readOnlyAllowed(ctx.method, ctx.path)) {
    fail(403, 'SUBSCRIPTION_READ_ONLY', 'Abonelik salt okunur modda. Yeni kayıt açmak için aboneliğinizi yenileyin.');
  }

  for (const g of GATED_PREFIXES) {
    if (ctx.path.startsWith(g.prefix) && !enabled(g.feature, scenario)) fail(403, 'FEATURE_DISABLED', 'This feature is not included in your plan');
  }

  const write = LIMITED_WRITES.find((w) => w.method === ctx.method && w.pattern.test(ctx.path));
  // Permission errors win, like on the API (RBAC middleware runs before the use case).
  if (!write || !ctx.permissions.has(write.perm)) return;
  const f = FEATURES.find((x) => x.key === write.feature)!;
  const limit = f.value as number | null;
  const used = usage(ctx, scenario)[write.feature] ?? 0;
  if (limit !== null && used + 1 > limit) {
    fail(409, 'LIMIT_REACHED', 'Plan limit reached', [
      { field: 'feature', message: write.feature },
      { field: 'limit', message: String(limit) },
      { field: 'used', message: String(used) },
      { field: 'tolerance', message: '0' },
      // The 100 % threshold notice goes to the owner with the first refusal of the period.
      { field: 'owner_notified', message: 'true' },
    ]);
  }
}

/** Whether the plan includes a toggle feature (used by the AI status mock). */
export const planFeatureEnabled = (key: string) => enabled(key);

// ─── Routes ────────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/billing/overview', (ctx): BillingOverview => {
  requirePerm(ctx, 'tenant.billing.read');
  const startsDaysAgo = 12;
  const endsIn = 18;
  return {
    subscription: {
      uuid: 'b5b50000-0000-4000-8000-000000000001',
      plan_code: PLAN.code,
      plan_name: PLAN.name,
      period: 'monthly',
      status: getPlanScenario() === 'read_only' ? 'read_only' : 'active',
      starts_at: iso(-startsDaysAgo),
      ends_at: iso(endsIn),
      grace_ends_at: iso(endsIn + 7),
      days_left: endsIn,
      credit_balance: '0.00',
      source: 'admin',
    },
    plan: PLAN,
    meters: meters(ctx),
    open_order: null,
    read_only: getPlanScenario() === 'read_only',
  };
});
