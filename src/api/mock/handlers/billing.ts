/**
 * Subscription / billing. Owned by the settings area. The mobile app is read-only here
 * (App Store 3.1.1), so only the read routes are mocked; purchases happen on the web.
 */
import type { BillingInvoice, BillingOrder, BillingOverview, BillingPlan, BillingUsageMeter, InvoiceProfile } from '@/features/billing/types';

import { fail, istanbulDay, paginate, requirePerm, route, type MockCtx } from '../core';
import { getDb } from '../db';

const DAY = 86400000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const feature = (
  key: string,
  label_tr: string,
  label_en: string,
  v: { int?: number | null; bool?: boolean | null; text?: string; unit?: string; kind?: 'limit' | 'toggle' | 'display' },
): BillingPlan['features'][number] => ({
  key,
  value_int: v.int ?? null,
  value_bool: v.bool ?? null,
  display_text: v.text ?? '',
  enforcement: 'hard',
  tolerance_pct: 0,
  warn_pct: 80,
  min_value: null,
  max_value: null,
  step: null,
  kind: v.kind ?? (v.bool !== undefined ? 'toggle' : v.text ? 'display' : 'limit'),
  unit: v.unit ?? '',
  label_tr,
  label_en,
  unit_price: null,
});

const PRO_PLAN: BillingPlan = {
  uuid: 'b111a000-0000-4000-8000-000000000002',
  code: 'pro',
  name: 'Profesyonel',
  description: 'Büyüyen oto yıkama ve detaylandırma işletmeleri için.',
  price_monthly: '1490.00',
  yearly_pricing: 'discount_percent',
  price_yearly: '0.00',
  yearly_discount_value: '15',
  effective_yearly: '15198.00',
  currency: 'TRY',
  trial_days: 14,
  is_public: true,
  is_customizable: false,
  is_active: true,
  badge: 'Popüler',
  sort_order: 2,
  live_subscriptions: 0,
  features: [
    feature('jobs_per_day', 'Günlük işlem', 'Jobs per day', { int: 150, unit: 'adet' }),
    feature('customers', 'Müşteri', 'Customers', { int: 5000 }),
    feature('staff_users', 'Personel kullanıcısı', 'Staff users', { int: 10 }),
    feature('ai_tokens', 'Asistan (token/ay)', 'Assistant (tokens/month)', { int: 200000 }),
    feature('ai_assistant', 'Yapay zekâ asistanı', 'AI assistant', { bool: true }),
    feature('whatsapp', 'WhatsApp bildirimleri', 'WhatsApp notifications', { bool: true }),
    feature('contracts', 'Dijital sözleşme', 'Digital contracts', { bool: true }),
    feature('multi_branch', 'Çoklu şube', 'Multiple branches', { bool: false }),
    feature('support', '', '', { text: 'Öncelikli destek' }),
  ],
};

function meters(ctx: MockCtx): BillingUsageMeter[] {
  const db = getDb();
  const today = istanbulDay();
  const month = today.slice(0, 7);
  const jobsToday = db.jobs.filter((j) => j._org === ctx.orgUuid && istanbulDay(j.started_at) === today).length;
  const staff = db.memberships.filter((m) => m.orgUuid === ctx.orgUuid && m.role !== 'owner').length;
  const limit = (key: string, used: number, lim: number | null, period: string, periodKey: string, extra: Partial<BillingUsageMeter> = {}): BillingUsageMeter => {
    const f = PRO_PLAN.features.find((x) => x.key === key)!;
    return {
      key,
      kind: 'limit',
      unit: f.unit ?? '',
      period,
      period_key: periodKey,
      limit: lim,
      used,
      warn_pct: 80,
      tolerance_pct: 0,
      enforcement: 'hard',
      enabled: null,
      label_tr: f.label_tr ?? key,
      label_en: f.label_en ?? key,
      ...extra,
    };
  };
  const toggle = (key: string): BillingUsageMeter => {
    const f = PRO_PLAN.features.find((x) => x.key === key)!;
    return { ...limit(key, 0, null, 'none', ''), kind: 'toggle', enabled: f.value_bool };
  };
  return [
    limit('jobs_per_day', jobsToday, 150, 'day', today),
    limit('customers', db.customers.length, 5000, 'total', ''),
    limit('staff_users', staff, 10, 'total', ''),
    limit('ai_tokens', 164250, 200000, 'month', month, { tolerance_pct: 10, enforcement: 'soft' }),
    toggle('ai_assistant'),
    toggle('whatsapp'),
    toggle('contracts'),
    toggle('multi_branch'),
  ];
}

function orders(ctx: MockCtx): BillingOrder[] {
  const org = getDb().organizations.find((o) => o.uuid === ctx.orgUuid);
  const ref = { uuid: PRO_PLAN.uuid, code: PRO_PLAN.code, name: PRO_PLAN.name };
  const make = (i: number, kind: BillingOrder['kind'], period: BillingOrder['period'], total: string, createdDaysAgo: number, invoice: string | null): BillingOrder => ({
    uuid: `b0de0000-0000-4000-8000-00000000000${i}`,
    reference_code: `OTP-${(org?.slug ?? 'demo').slice(0, 4).toUpperCase()}-${1040 + i}`,
    kind,
    status: 'approved',
    channel: 'bank_transfer',
    plan: ref,
    period,
    custom_features: {},
    list_price: total,
    proration_credit: '0.00',
    discount_code: null,
    discount_amount: '0.00',
    credit_applied: '0.00',
    credit_surplus: '0.00',
    total,
    vat_amount: (Number(total) - Number(total) / 1.2).toFixed(2),
    lines: [{ kind: 'plan', label: `${PRO_PLAN.name} · ${period === 'monthly' ? 'Aylık' : 'Yıllık'}`, amount: total }],
    has_receipt: true,
    receipt_content_type: 'application/pdf',
    report_note: '',
    reported_at: iso(-createdDaysAgo + 1),
    reviewed_at: iso(-createdDaysAgo + 1),
    reject_reason: '',
    expires_at: iso(-createdDaysAgo + 7),
    created_at: iso(-createdDaysAgo),
    instructions: null,
    organization: org ? { uuid: org.uuid, slug: org.slug, name: org.name } : null,
    invoice_uuid: invoice,
  });
  return [make(2, 'renew', 'monthly', '1490.00', 12, 'b1f00000-0000-4000-8000-000000000002'), make(1, 'new', 'monthly', '1490.00', 42, 'b1f00000-0000-4000-8000-000000000001')];
}

function invoices(ctx: MockCtx): BillingInvoice[] {
  const org = getDb().organizations.find((o) => o.uuid === ctx.orgUuid);
  return orders(ctx).map((o, i) => ({
    uuid: o.invoice_uuid!,
    number: `OTP2026${String(1042 - i).padStart(9, '0')}`,
    issue_date: istanbulDay(o.reviewed_at ?? o.created_at),
    status: 'issued',
    order_uuid: o.uuid,
    order_reference: o.reference_code,
    buyer: { name: org?.name ?? '', tax_id: '1234567890', tax_office: 'Kadıköy', is_final_consumer: false },
    subtotal: (Number(o.total) / 1.2).toFixed(2),
    discount_total: '0.00',
    vat_total: o.vat_amount,
    grand_total: o.total,
    has_xml: true,
    has_pdf: i === 0 || i === 1,
    error: '',
    created_at: o.reviewed_at ?? o.created_at,
    organization: o.organization,
  }));
}

route('GET', '/v1/tenant/billing/overview', (ctx): BillingOverview => {
  requirePerm(ctx, 'tenant.billing.read');
  const startsDaysAgo = 12;
  const endsIn = 18;
  return {
    subscription: {
      uuid: 'b5b50000-0000-4000-8000-000000000001',
      plan_code: PRO_PLAN.code,
      plan_name: PRO_PLAN.name,
      period: 'monthly',
      status: 'active',
      starts_at: iso(-startsDaysAgo),
      ends_at: iso(endsIn),
      grace_ends_at: iso(endsIn + 7),
      days_left: endsIn,
      credit_balance: '120.00',
      source: 'self_service',
    },
    plan: PRO_PLAN,
    meters: meters(ctx),
    open_order: null,
    read_only: false,
  };
});

route('GET', '/v1/tenant/billing/plans', (ctx) => {
  requirePerm(ctx, 'tenant.billing.read');
  return [PRO_PLAN];
});

route('GET', '/v1/tenant/billing/orders', (ctx) => {
  requirePerm(ctx, 'tenant.billing.read');
  const all = orders(ctx);
  const open = ctx.query.status === 'open' ? all.filter((o) => o.status === 'pending_payment' || o.status === 'payment_reported') : all;
  return paginate(open, ctx.query);
});

route('GET', '/v1/tenant/billing/orders/:uuid', (ctx) => {
  requirePerm(ctx, 'tenant.billing.read');
  return orders(ctx).find((o) => o.uuid === ctx.params.uuid) ?? fail(404, 'NOT_FOUND', 'Order not found');
});

route('GET', '/v1/tenant/billing/invoice-profile', (ctx): InvoiceProfile => {
  requirePerm(ctx, 'tenant.billing.read');
  const org = getDb().organizations.find((o) => o.uuid === ctx.orgUuid);
  return {
    invoice_name: org?.name ?? '',
    invoice_tax_id: '1234567890',
    invoice_tax_office: 'Kadıköy',
    invoice_address: org?.address ?? '',
    invoice_city: org?.city ?? '',
    invoice_email: org?.email ?? '',
  };
});

route('GET', '/v1/tenant/billing/invoices', (ctx) => {
  requirePerm(ctx, 'tenant.billing.read');
  return paginate(invoices(ctx), ctx.query, 50);
});
