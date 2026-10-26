/**
 * Loyalty & packages (`/v1/tenant/loyalty/*`, `/v1/tenant/customers/:uuid/loyalty`, `/v1/tenant/jobs/:uuid/loyalty*`;
 * backend `modules/loyalty`). Same rules as the Go use case:
 * - stamp campaigns: one stamp per running campaign with an eligible charged line when a job is delivered and paid
 *   (idempotent per job), reversed on cancel / void; a reward covers a line and spends `stamps_required` stamps;
 * - packages: sold with a cash / card / cari payment (`Paket Satışı`), credits cover job lines, cancel refunds when
 *   no credit was used;
 * - subscriptions: periods anchored on the start date, `paid_through` is the renewal date, past due when it is
 *   today or earlier, uses per period counted from applied rows (unlimited when omitted).
 * Applying loyalty sets the line's `discount_amount` / `discount_source` and drops the job total; a job loyalty
 * fully covered closes paid without a payment (jobs.ts). Rows live per organization and are seeded lazily.
 */
import type { components } from '@/api/generated/api';

import { fail, istanbulDay, money, notFound, now, num, paginate, requirePerm, route, search, str, uuid, uuidQuery, type MockCtx } from '../core';
import { getDb, type MockDb } from '../db';
import { categoryByName, chargeFromSource, financeAccount, postFinance, voidCariEntry, voidFinanceBySource } from '../ops';
import { planFeatureEnabled } from './billing';

type Schemas = components['schemas'];
type Campaign = Schemas['LoyaltyCampaign'];
type Package = Schemas['LoyaltyPackage'];
type Plan = Schemas['LoyaltyPlan'];
type CustomerPackage = Schemas['LoyaltyCustomerPackage'];
type CustomerPackageDetail = Schemas['LoyaltyCustomerPackageDetail'];
type Subscription = Schemas['LoyaltySubscription'];
type SubscriptionDetail = Schemas['LoyaltySubscriptionDetail'];
type Period = Schemas['LoyaltyPeriod'];
type StampCard = Schemas['LoyaltyStampCard'];
type Option = Schemas['LoyaltyOption'];
type JobLoyalty = Schemas['JobLoyalty'];
type Usage = Schemas['LoyaltyUsage'];
type Kind = 'reward' | 'package' | 'subscription';
type Method = 'cash' | 'card' | 'cari';
type JobRow = MockDb['jobs'][number];

const FEATURE = 'loyalty.enabled';
const CAT_PACKAGE = 'Paket Satışı';
const CAT_SUBSCRIPTION = 'Abonelik Geliri';
const SRC_PACKAGE = 'loyalty_package';
const SRC_SUBSCRIPTION = 'loyalty_subscription';

// ─── Rows ──────────────────────────────────────────────────────────────────

type Base = { _org: string; uuid: string; created_at: string; updated_at: string; deleted?: boolean };
type CampaignRow = Base & {
  name: string;
  description: string;
  service_uuids: string[];
  category_uuids: string[];
  stamps_required: number;
  reward_type: 'free_service' | 'percent' | 'fixed';
  reward_service_uuid?: string;
  reward_value: string;
  valid_from?: string;
  valid_until?: string;
  is_active: boolean;
  per_customer_limit?: number;
};
type PackageRow = Base & {
  name: string;
  description: string;
  price: string;
  currency: string;
  validity_days?: number;
  is_active: boolean;
  items: { service_uuid: string; quantity: number }[];
};
type PlanRow = Base & {
  name: string;
  description: string;
  price: string;
  currency: string;
  period_months: number;
  uses_per_period?: number;
  service_uuids: string[];
  category_uuids: string[];
  is_active: boolean;
};
type CustomerPackageRow = {
  _org: string;
  uuid: string;
  package_uuid?: string;
  customer_uuid: string;
  name: string;
  price: string;
  currency: string;
  status: 'active' | 'cancelled';
  purchased_at: string;
  expires_at?: string;
  payment_method: Method;
  credits: { service_uuid: string; service_name: string; total: number; used: number }[];
  notes: string;
  cancelled_at?: string;
  cari_entry_uuid?: string;
};
type SubscriptionRow = {
  _org: string;
  uuid: string;
  plan_uuid?: string;
  customer_uuid: string;
  vehicle_uuid?: string;
  name: string;
  price: string;
  currency: string;
  period_months: number;
  uses_per_period?: number;
  start_date: string;
  paid_through: string;
  status: 'active' | 'cancelled';
  notes: string;
  cancelled_at?: string;
  created_at: string;
};
type PaymentRow = {
  _org: string;
  uuid: string;
  subscription_uuid: string;
  period_start: string;
  period_end: string;
  amount: string;
  currency: string;
  method: Method;
  finance_account_name?: string;
  cari_entry_uuid?: string;
  created_at: string;
};
type StampEvent = { _org: string; campaign_uuid: string; customer_uuid: string; job_uuid?: string; kind: 'earn' | 'reverse_earn' | 'redeem' | 'unredeem'; stamps: number; at: string };
type ApplicationRow = {
  _org: string;
  uuid: string;
  job_uuid: string;
  line_uuid: string;
  customer_uuid: string;
  kind: Kind;
  source_uuid: string;
  source_name: string;
  line_name: string;
  units: number;
  discount_amount: string;
  status: 'applied' | 'reverted';
  period_start?: string;
  credit_service_uuid?: string;
  created_at: string;
};
type Store = {
  campaigns: CampaignRow[];
  packages: PackageRow[];
  plans: PlanRow[];
  customerPackages: CustomerPackageRow[];
  subscriptions: SubscriptionRow[];
  payments: PaymentRow[];
  stamps: StampEvent[];
  applications: ApplicationRow[];
  seededOrgs: string[];
};

function store(): Store {
  const db = getDb() as MockDb & { _loyalty?: Store };
  db._loyalty ??= { campaigns: [], packages: [], plans: [], customerPackages: [], subscriptions: [], payments: [], stamps: [], applications: [], seededOrgs: [] };
  return db._loyalty;
}

/** The organization's store, seeded on first use. */
function orgData(org: string) {
  const s = store();
  if (!s.seededOrgs.includes(org)) {
    s.seededOrgs.push(org);
    seed(s, org);
  }
  const mine = <T extends { _org: string }>(rows: T[]) => rows.filter((r) => r._org === org);
  return {
    s,
    campaigns: mine(s.campaigns).filter((r) => !r.deleted),
    packages: mine(s.packages).filter((r) => !r.deleted),
    plans: mine(s.plans).filter((r) => !r.deleted),
    customerPackages: mine(s.customerPackages),
    subscriptions: mine(s.subscriptions),
    payments: mine(s.payments),
    stamps: mine(s.stamps),
    applications: mine(s.applications),
  };
}

// ─── Values ────────────────────────────────────────────────────────────────

const invalid = (message: string): never => fail(400, 'VALIDATION_ERROR', message, [{ message }]);
const conflict = (message: string): never => fail(409, 'CONFLICT', message);
const notApplicable = (message: string): never => fail(409, 'NOT_APPLICABLE', message);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  return istanbulDay();
}

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Months added to a day, clamped to the month's last day (backend `addMonths`). */
function addMonths(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

function periodIndex(start: string, months: number, day: string) {
  if (day < start || months <= 0) return -1;
  let k = 0;
  while (addMonths(start, (k + 1) * months) <= day) k++;
  return k;
}

const periodBounds = (start: string, months: number, k: number) => [addMonths(start, k * months), addMonths(start, (k + 1) * months)] as const;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

function parseDay(v: unknown, field: string) {
  const s = str(v).trim();
  if (!s) return undefined;
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) invalid(`${field} must be YYYY-MM-DD`);
  return s;
}

function positiveMoney(v: unknown, field: string) {
  const n = Number(str(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) invalid(`${field} must be a positive amount`);
  return money(n);
}

function optInt(v: unknown, min: number, max: number, message: string) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) invalid(message);
  return n;
}

function name(v: unknown) {
  const s = str(v).trim();
  if (!s) invalid('name is required');
  if (s.length > 150) invalid('name is limited to 150 characters');
  return s;
}

function currency(v: unknown) {
  const s = str(v, 'TRY').trim().toUpperCase() || 'TRY';
  if (!/^[A-Z]{3}$/.test(s)) invalid('currency must be a 3-letter code');
  return s;
}

const uuidList = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);

function serviceRefs(ids: string[]) {
  const db = getDb();
  return ids.map((id) => {
    const svc = db.services.find((x) => x.uuid === id);
    if (!svc) invalid('unknown service');
    return { uuid: svc!.uuid, name: svc!.name };
  });
}

function categoryRefs(ids: string[]) {
  const db = getDb();
  return ids.map((id) => {
    const c = db.catalogCategories.find((x) => x.uuid === id && x.kind === 'service');
    if (!c) invalid('unknown service category');
    return { uuid: c!.uuid, name: c!.name };
  });
}

/** Whether a service (by its catalog row) is covered by the service / category lists. */
function eligible(serviceUuids: string[], categoryUuids: string[], serviceUuid: string | null | undefined) {
  if (!serviceUuid) return false;
  if (serviceUuids.includes(serviceUuid)) return true;
  const cat = getDb().services.find((x) => x.uuid === serviceUuid)?.category_uuid;
  return Boolean(cat && categoryUuids.includes(cat));
}

const customerOf = (customerUuid: string) => getDb().customers.find((c) => c.uuid === customerUuid);
function customerIn(ctx: MockCtx, customerUuid: string | undefined) {
  if (!customerUuid) invalid('customer_uuid is required');
  const c = customerOf(customerUuid!);
  if (!c) notFound('Customer');
  return c!;
}

function listParams(ctx: MockCtx) {
  const active = ctx.query.is_active;
  return { q: ctx.query.q, active: active === 'true' ? true : active === 'false' ? false : undefined };
}

const byCreatedDesc = <T extends { created_at: string }>(rows: T[]) => [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

// ─── Views ─────────────────────────────────────────────────────────────────

function campaignView(r: CampaignRow): Campaign {
  const out: Campaign = {
    uuid: r.uuid,
    name: r.name,
    description: r.description,
    services: serviceRefs(r.service_uuids),
    categories: categoryRefs(r.category_uuids),
    stamps_required: r.stamps_required,
    reward_type: r.reward_type,
    reward_value: r.reward_value,
    is_active: r.is_active,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (r.reward_service_uuid) out.reward_service = serviceRefs([r.reward_service_uuid])[0];
  if (r.valid_from) out.valid_from = r.valid_from;
  if (r.valid_until) out.valid_until = r.valid_until;
  if (r.per_customer_limit) out.per_customer_limit = r.per_customer_limit;
  return out;
}

function packageView(org: string, r: PackageRow): Package {
  const db = getDb();
  const items = r.items.map((it) => {
    const svc = db.services.find((x) => x.uuid === it.service_uuid);
    return { service_uuid: it.service_uuid, service_name: svc?.name ?? '', quantity: it.quantity, unit_price: money(num(svc?.price)) };
  });
  const out: Package = {
    uuid: r.uuid,
    name: r.name,
    description: r.description,
    price: r.price,
    currency: r.currency,
    is_active: r.is_active,
    items,
    list_value: money(items.reduce((s, it) => s + it.quantity * num(it.unit_price), 0)),
    sold_count: store().customerPackages.filter((c) => c._org === org && c.package_uuid === r.uuid).length,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (r.validity_days) out.validity_days = r.validity_days;
  return out;
}

function planView(org: string, r: PlanRow): Plan {
  const out: Plan = {
    uuid: r.uuid,
    name: r.name,
    description: r.description,
    price: r.price,
    currency: r.currency,
    period_months: r.period_months,
    services: serviceRefs(r.service_uuids),
    categories: categoryRefs(r.category_uuids),
    is_active: r.is_active,
    active_count: store().subscriptions.filter((s) => s._org === org && s.plan_uuid === r.uuid && s.status === 'active').length,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (r.uses_per_period) out.uses_per_period = r.uses_per_period;
  return out;
}

function packageState(r: CustomerPackageRow): CustomerPackage['state'] {
  const total = r.credits.reduce((s, c) => s + c.total, 0);
  const used = r.credits.reduce((s, c) => s + c.used, 0);
  if (r.status === 'cancelled') return 'cancelled';
  if (r.expires_at && r.expires_at <= now()) return 'expired';
  if (used >= total) return 'used_up';
  return 'active';
}

function customerPackageView(r: CustomerPackageRow): CustomerPackage {
  const out: CustomerPackage = {
    uuid: r.uuid,
    customer_uuid: r.customer_uuid,
    customer_name: customerOf(r.customer_uuid)?.name ?? '',
    name: r.name,
    price: r.price,
    currency: r.currency,
    state: packageState(r),
    purchased_at: r.purchased_at,
    payment_method: r.payment_method,
    credits_total: r.credits.reduce((s, c) => s + c.total, 0),
    credits_used: r.credits.reduce((s, c) => s + c.used, 0),
    credits: r.credits.map((c) => ({ ...c, remaining: Math.max(c.total - c.used, 0) })),
    notes: r.notes,
  };
  if (r.package_uuid) out.package_uuid = r.package_uuid;
  if (r.expires_at) out.expires_at = r.expires_at;
  if (r.cancelled_at) out.cancelled_at = r.cancelled_at;
  return out;
}

function usageOf(org: string, sourceUuid: string): Usage[] {
  const db = getDb();
  return byCreatedDesc(store().applications.filter((a) => a._org === org && a.source_uuid === sourceUuid)).map((a) => {
    const u: Usage = {
      uuid: a.uuid,
      job_uuid: a.job_uuid,
      plate: db.jobs.find((j) => j.uuid === a.job_uuid)?.plate ?? '',
      line_name: a.line_name,
      units: a.units,
      discount_amount: a.discount_amount,
      status: a.status,
      created_at: a.created_at,
    };
    if (a.period_start) u.period_start = a.period_start;
    return u;
  });
}

const customerPackageDetail = (r: CustomerPackageRow): CustomerPackageDetail => ({ ...customerPackageView(r), usage: usageOf(r._org, r.uuid) });

function usesIn(r: SubscriptionRow, periodStart: string) {
  return store()
    .applications.filter((a) => a._org === r._org && a.source_uuid === r.uuid && a.status === 'applied' && a.period_start === periodStart)
    .reduce((n, a) => n + a.units, 0);
}

function currentPeriod(r: SubscriptionRow, day: string): Period | undefined {
  if (r.status !== 'active' || r.paid_through <= day || day < r.start_date) return undefined;
  const [from, to] = periodBounds(r.start_date, r.period_months, periodIndex(r.start_date, r.period_months, day));
  const used = usesIn(r, from);
  const p: Period = { start: from, end: to, used };
  if (r.uses_per_period) {
    p.limit = r.uses_per_period;
    p.remaining = Math.max(r.uses_per_period - used, 0);
  }
  return p;
}

function subscriptionView(r: SubscriptionRow): Subscription {
  const day = today();
  const c = customerOf(r.customer_uuid);
  const out: Subscription = {
    uuid: r.uuid,
    customer_uuid: r.customer_uuid,
    customer_name: c?.name ?? '',
    customer_phone: c?.phone ?? '',
    name: r.name,
    price: r.price,
    currency: r.currency,
    period_months: r.period_months,
    start_date: r.start_date,
    renewal_date: r.paid_through,
    days_until_renewal: daysBetween(day, r.paid_through),
    state: r.status === 'cancelled' ? 'cancelled' : r.paid_through <= day ? 'past_due' : 'active',
    notes: r.notes,
    created_at: r.created_at,
  };
  if (r.plan_uuid) out.plan_uuid = r.plan_uuid;
  if (r.vehicle_uuid) {
    out.vehicle_uuid = r.vehicle_uuid;
    const plate = getDb().vehicles.find((v) => v.uuid === r.vehicle_uuid)?.plate;
    if (plate) out.plate = plate;
  }
  if (r.uses_per_period) out.uses_per_period = r.uses_per_period;
  if (r.cancelled_at) out.cancelled_at = r.cancelled_at;
  const period = currentPeriod(r, day);
  if (period) out.current_period = period;
  return out;
}

function nextPeriod(r: SubscriptionRow) {
  const k = Math.max(periodIndex(r.start_date, r.period_months, r.paid_through), 0);
  return periodBounds(r.start_date, r.period_months, k);
}

function subscriptionDetail(r: SubscriptionRow): SubscriptionDetail {
  const [from, to] = nextPeriod(r);
  const next: Period = { start: from, end: to, used: 0 };
  if (r.uses_per_period) next.limit = r.uses_per_period;
  return {
    ...subscriptionView(r),
    next_period: next,
    payments: byCreatedDesc(store().payments.filter((p) => p._org === r._org && p.subscription_uuid === r.uuid)).map(({ _org, subscription_uuid: _s, cari_entry_uuid: _c, ...p }) => p),
    usage: usageOf(r._org, r.uuid),
  };
}

// ─── Stamps ────────────────────────────────────────────────────────────────

const running = (c: CampaignRow, day: string) => c.is_active && !c.deleted && (!c.valid_from || c.valid_from <= day) && (!c.valid_until || c.valid_until >= day);

function balances(org: string, customerUuid: string) {
  const out = new Map<string, { balance: number; redeemed: number }>();
  for (const e of store().stamps) {
    if (e._org !== org || e.customer_uuid !== customerUuid) continue;
    const b = out.get(e.campaign_uuid) ?? { balance: 0, redeemed: 0 };
    b.balance += e.stamps;
    if (e.kind === 'redeem') b.redeemed += 1;
    if (e.kind === 'unredeem') b.redeemed -= 1;
    out.set(e.campaign_uuid, b);
  }
  return out;
}

function rewardsAvailable(balance: number, required: number, limit: number | undefined, redeemed: number) {
  if (required <= 0 || balance <= 0) return { n: 0, limited: limit !== undefined && redeemed >= limit };
  let n = Math.floor(balance / required);
  if (limit !== undefined) {
    const left = limit - redeemed;
    if (left <= 0) return { n: 0, limited: true };
    n = Math.min(n, left);
  }
  return { n, limited: false };
}

function stampCards(org: string, customerUuid: string): (StampCard & { _c: CampaignRow })[] {
  const day = today();
  const bal = balances(org, customerUuid);
  const rows = store().campaigns.filter((c) => c._org === org && !c.deleted && (running(c, day) || (bal.get(c.uuid)?.balance ?? 0) > 0));
  return rows.map((c) => {
    const b = bal.get(c.uuid) ?? { balance: 0, redeemed: 0 };
    const active = running(c, day);
    const avail = rewardsAvailable(b.balance, c.stamps_required, c.per_customer_limit, b.redeemed);
    const card: StampCard & { _c: CampaignRow } = {
      campaign_uuid: c.uuid,
      campaign_name: c.name,
      stamps_required: c.stamps_required,
      stamps: c.stamps_required > 0 && b.balance > 0 ? b.balance % c.stamps_required : 0,
      balance: b.balance,
      rewards_available: active ? avail.n : 0,
      rewards_redeemed: b.redeemed,
      reward_type: c.reward_type,
      reward_value: c.reward_value,
      active,
      limit_reached: avail.limited,
      _c: c,
    };
    if (c.reward_service_uuid) card.reward_service = serviceRefs([c.reward_service_uuid])[0];
    return card;
  });
}

const plainCards = (cards: ReturnType<typeof stampCards>): StampCard[] => cards.map(({ _c, ...c }) => c);

// ─── Job section ───────────────────────────────────────────────────────────

const editable = (job: JobRow) => job.payment_status === 'unpaid' && ['in_progress', 'ready', 'delivered'].includes(job.status);
const lineGross = (l: JobRow['lines'][number]) => Math.round(num(l.unit_price) * num(l.qty) * 100) / 100;
const coverable = (l: JobRow['lines'][number]) => l.line_type === 'service' && Boolean(l.service_uuid) && !l.discount_source && num(l.line_total) > 0;
const wholeUnits = (qty: string) => Math.max(Math.floor(num(qty)), 1);

function options(job: JobRow, cards: ReturnType<typeof stampCards>): Option[] {
  const org = job._org;
  const open = job.lines.filter(coverable);
  if (!open.length) return [];
  const out: Option[] = [];
  for (const card of cards) {
    if (card.rewards_available <= 0 || !card.active) continue;
    const c = card._c;
    for (const l of open) {
      const gross = lineGross(l);
      let discount = 0;
      if (c.reward_type === 'free_service') {
        if (c.reward_service_uuid !== l.service_uuid) continue;
        discount = Math.min(num(l.unit_price), gross);
      } else if (c.reward_type === 'percent') {
        if (!eligible(c.service_uuids, c.category_uuids, l.service_uuid)) continue;
        discount = Math.round(((gross * num(c.reward_value)) / 100) * 100) / 100;
      } else {
        if (!eligible(c.service_uuids, c.category_uuids, l.service_uuid)) continue;
        discount = Math.min(num(c.reward_value), gross);
      }
      if (discount <= 0) continue;
      out.push({ kind: 'reward', source_uuid: c.uuid, source_name: c.name, line_uuid: l.uuid, line_name: l.name, units: 1, discount_amount: money(discount) });
    }
  }
  for (const cp of store().customerPackages.filter((p) => p._org === org && p.customer_uuid === job.customer_uuid && packageState(p) === 'active')) {
    for (const cr of cp.credits) {
      for (const l of open) {
        if (cr.service_uuid !== l.service_uuid) continue;
        const left = cr.total - cr.used;
        const units = Math.min(wholeUnits(l.qty), left);
        if (units <= 0) continue;
        out.push({
          kind: 'package',
          source_uuid: cp.uuid,
          source_name: cp.name,
          line_uuid: l.uuid,
          line_name: l.name,
          units,
          discount_amount: money(Math.min(num(l.unit_price) * units, lineGross(l))),
          remaining: left - units,
        });
      }
    }
  }
  const day = today();
  for (const sub of store().subscriptions.filter((x) => x._org === org && x.customer_uuid === job.customer_uuid && x.status === 'active')) {
    if (sub.vehicle_uuid && sub.vehicle_uuid !== job.vehicle_uuid) continue;
    const plan = store().plans.find((p) => p.uuid === sub.plan_uuid && p._org === org);
    const period = currentPeriod(sub, day);
    if (!plan || !period) continue;
    for (const l of open) {
      if (!eligible(plan.service_uuids, plan.category_uuids, l.service_uuid)) continue;
      let units = wholeUnits(l.qty);
      let remaining: number | undefined;
      if (period.remaining !== undefined) {
        units = Math.min(units, period.remaining);
        remaining = period.remaining - units;
      }
      if (units <= 0) continue;
      const o: Option = {
        kind: 'subscription',
        source_uuid: sub.uuid,
        source_name: sub.name,
        line_uuid: l.uuid,
        line_name: l.name,
        units,
        discount_amount: money(Math.min(num(l.unit_price) * units, lineGross(l))),
      };
      if (remaining !== undefined) o.remaining = remaining;
      out.push(o);
    }
  }
  const rank: Record<Kind, number> = { subscription: 0, package: 1, reward: 2 };
  return out.sort((a, b) => num(b.discount_amount) - num(a.discount_amount) || rank[a.kind] - rank[b.kind]);
}

function jobView(job: JobRow): JobLoyalty {
  const org = job._org;
  const cards = stampCards(org, job.customer_uuid);
  const s = store();
  const net = new Map<string, number>();
  for (const e of s.stamps) if (e._org === org && e.job_uuid === job.uuid && (e.kind === 'earn' || e.kind === 'reverse_earn')) net.set(e.campaign_uuid, (net.get(e.campaign_uuid) ?? 0) + e.stamps);
  return {
    job_uuid: job.uuid,
    customer_uuid: job.customer_uuid,
    editable: editable(job),
    applied: s.applications
      .filter((a) => a._org === org && a.job_uuid === job.uuid)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .map((a) => ({
        uuid: a.uuid,
        kind: a.kind,
        source_uuid: a.source_uuid,
        source_name: a.source_name,
        line_uuid: a.line_uuid,
        line_name: a.line_name,
        units: a.units,
        discount_amount: a.discount_amount,
        status: a.status,
        created_at: a.created_at,
      })),
    options: editable(job) ? options(job, cards) : [],
    stamps: plainCards(cards),
    stamps_earned: [...net.entries()]
      .filter(([, n]) => n > 0)
      .map(([id]) => s.campaigns.find((c) => c.uuid === id))
      .filter((c): c is CampaignRow => Boolean(c))
      .map((c) => ({ uuid: c.uuid, name: c.name })),
  };
}

function recalcTotal(job: JobRow) {
  job.total_amount = money(job.lines.reduce((s, l) => s + num(l.line_total), 0));
  job.updated_at = now();
}

function setLineDiscount(line: JobRow['lines'][number], discount: number, source?: Kind) {
  if (source) {
    line.discount_amount = money(discount);
    line.discount_source = source;
  } else {
    delete line.discount_amount;
    delete line.discount_source;
  }
  line.line_total = money(Math.max(lineGross(line) - discount, 0));
}

/** Gives back what an application took (stamps, credits); uses are counted from applied rows. */
function revertApplication(a: ApplicationRow, restoreLine: boolean, job: JobRow) {
  const s = store();
  a.status = 'reverted';
  if (a.kind === 'reward') s.stamps.push({ _org: a._org, campaign_uuid: a.source_uuid, customer_uuid: a.customer_uuid, job_uuid: a.job_uuid, kind: 'unredeem', stamps: a.units, at: now() });
  if (a.kind === 'package') {
    const credit = s.customerPackages.find((p) => p.uuid === a.source_uuid)?.credits.find((c) => c.service_uuid === a.credit_service_uuid);
    if (credit) credit.used = Math.max(credit.used - a.units, 0);
  }
  if (restoreLine) {
    const line = job.lines.find((l) => l.uuid === a.line_uuid);
    if (line) setLineDiscount(line, 0);
  }
}

// ─── Job hooks (jobs.ts) ───────────────────────────────────────────────────

/** True when loyalty covers at least one line (a zero-total job may then close without a payment). */
export const loyaltyCovered = (job: JobRow) => job.lines.some((l) => Boolean(l.discount_source));

/** Delivered + paid: one stamp per running campaign with an eligible charged line (idempotent per job). */
export function loyaltyJobSettled(job: JobRow) {
  if (job.status !== 'delivered' || job.payment_status !== 'paid' || !planFeatureEnabled(FEATURE)) return;
  const { s, campaigns } = orgData(job._org);
  const day = istanbulDay(job.delivered_at && job.paid_at && job.delivered_at > job.paid_at ? job.delivered_at : (job.paid_at ?? now()));
  const bal = balances(job._org, job.customer_uuid);
  for (const c of campaigns.filter((x) => running(x, day))) {
    if (!job.lines.some((l) => l.line_type === 'service' && num(l.line_total) > 0 && eligible(c.service_uuids, c.category_uuids, l.service_uuid))) continue;
    if (c.per_customer_limit !== undefined) {
      const b = bal.get(c.uuid) ?? { balance: 0, redeemed: 0 };
      const pending = c.stamps_required > 0 && b.balance > 0 ? Math.floor(b.balance / c.stamps_required) : 0;
      if (b.redeemed + pending >= c.per_customer_limit) continue;
    }
    if (s.stamps.some((e) => e.campaign_uuid === c.uuid && e.job_uuid === job.uuid && e.kind === 'earn')) continue;
    s.stamps.push({ _org: job._org, campaign_uuid: c.uuid, customer_uuid: job.customer_uuid, job_uuid: job.uuid, kind: 'earn', stamps: 1, at: now() });
  }
}

/** Cancel / void: applications go back (line prices stay) and the stamps the job earned are reversed. */
export function loyaltyJobReversed(job: JobRow) {
  const s = store();
  for (const a of s.applications.filter((x) => x._org === job._org && x.job_uuid === job.uuid && x.status === 'applied')) revertApplication(a, false, job);
  for (const e of s.stamps.filter((x) => x._org === job._org && x.job_uuid === job.uuid && x.kind === 'earn')) {
    if (s.stamps.some((r) => r.job_uuid === job.uuid && r.campaign_uuid === e.campaign_uuid && r.kind === 'reverse_earn')) continue;
    s.stamps.push({ _org: job._org, campaign_uuid: e.campaign_uuid, customer_uuid: e.customer_uuid, job_uuid: job.uuid, kind: 'reverse_earn', stamps: -e.stamps, at: now() });
  }
}

// ─── Payments ──────────────────────────────────────────────────────────────

/** Posts income (cash / card → finance account, cari → customer charge) like the backend `post`. */
function collect(
  db: MockDb,
  body: Record<string, unknown>,
  input: { customerUuid: string; amount: number; category: string; sourceType: string; sourceUuid: string; description: string },
) {
  const method = str(body.method) as Method;
  if (!['cash', 'card', 'cari'].includes(method)) invalid('method must be cash, card or cari');
  const at = now();
  if (method === 'cari') {
    const entry = chargeFromSource(db, input.customerUuid, input.amount, input.description, at);
    return { method, cariEntryUuid: entry.uuid, accountName: undefined as string | undefined };
  }
  if (!body.finance_account_uuid) invalid('finance_account_uuid is required for cash / card');
  const account = financeAccount(db, str(body.finance_account_uuid));
  postFinance(db, {
    type: 'income',
    accountUuid: account.uuid,
    categoryUuid: categoryByName(db, input.category, 'income').uuid,
    amount: input.amount,
    date: istanbulDay(at),
    description: input.description,
    paymentMethod: method,
    sourceType: input.sourceType,
    sourceUuid: input.sourceUuid,
    at,
  });
  return { method, cariEntryUuid: undefined as string | undefined, accountName: account.name };
}

// ─── Guards ────────────────────────────────────────────────────────────────

function enabled() {
  if (!planFeatureEnabled(FEATURE)) fail(403, 'FEATURE_DISABLED', 'This feature is not included in your plan');
}

const read = (ctx: MockCtx) => {
  requirePerm(ctx, 'tenant.loyalty.read');
  enabled();
  return orgData(ctx.orgUuid!);
};
const write = (ctx: MockCtx) => {
  requirePerm(ctx, 'tenant.loyalty.write');
  enabled();
  return orgData(ctx.orgUuid!);
};
const apply = (ctx: MockCtx) => {
  requirePerm(ctx, 'tenant.loyalty.apply');
  enabled();
  return orgData(ctx.orgUuid!);
};

function found<T extends { uuid: string }>(rows: T[], id: string, what: string) {
  const row = rows.find((r) => r.uuid === id);
  if (!row) notFound(what);
  return row!;
}

// ─── Overview ──────────────────────────────────────────────────────────────

route('GET', '/v1/tenant/loyalty/overview', (ctx) => {
  const d = read(ctx);
  let horizon = Number(ctx.query.days ?? 7) || 7;
  if (horizon <= 0 || horizon > 60) horizon = 7;
  const day = today();
  const views = d.subscriptions.filter((s) => s.status === 'active');
  const due = views.filter((s) => s.paid_through <= addDays(day, horizon)).sort((a, b) => (a.paid_through < b.paid_through ? -1 : 1));
  return {
    active_campaigns: d.campaigns.filter((c) => c.is_active).length,
    active_packages: d.packages.filter((p) => p.is_active).length,
    active_plans: d.plans.filter((p) => p.is_active).length,
    customer_packages_active: d.customerPackages.filter((p) => packageState(p) === 'active').length,
    subscriptions_active: views.filter((s) => s.paid_through > day).length,
    subscriptions_past_due: views.filter((s) => s.paid_through <= day).length,
    renewals_upcoming: views.filter((s) => s.paid_through > day && s.paid_through <= addDays(day, horizon)).length,
    horizon_days: horizon,
    renewals: due.slice(0, 10).map(subscriptionView),
  };
});

// ─── Campaigns ─────────────────────────────────────────────────────────────

function campaignFields(b: Record<string, unknown>) {
  const stamps = Number(b.stamps_required);
  if (!Number.isInteger(stamps) || stamps < 1 || stamps > 100) invalid('stamps_required must be between 1 and 100');
  const services = uuidList(b.service_uuids);
  const categories = uuidList(b.category_uuids);
  serviceRefs(services);
  categoryRefs(categories);
  if (!services.length && !categories.length) invalid('choose at least one eligible service or category');
  const type = str(b.reward_type) as CampaignRow['reward_type'];
  let rewardService: string | undefined;
  let value = '0.00';
  if (type === 'free_service') {
    rewardService = str(b.reward_service_uuid) || undefined;
    if (!rewardService) invalid('reward_service_uuid is required for a free service reward');
    serviceRefs([rewardService!]);
  } else if (type === 'percent' || type === 'fixed') {
    value = positiveMoney(b.reward_value, 'reward_value');
    if (type === 'percent' && num(value) > 100) invalid('a percent reward is at most 100');
  } else invalid('reward_type must be free_service, percent or fixed');
  const from = parseDay(b.valid_from, 'valid_from');
  const until = parseDay(b.valid_until, 'valid_until');
  if (from && until && until < from) invalid('valid_until is before valid_from');
  return {
    name: name(b.name),
    description: str(b.description).trim().slice(0, 1000),
    service_uuids: services,
    category_uuids: categories,
    stamps_required: stamps,
    reward_type: type,
    reward_service_uuid: rewardService,
    reward_value: value,
    valid_from: from,
    valid_until: until,
    is_active: b.is_active === undefined ? true : Boolean(b.is_active),
    per_customer_limit: optInt(b.per_customer_limit, 1, 1000, 'per_customer_limit must be between 1 and 1000'),
  };
}

route('GET', '/v1/tenant/loyalty/campaigns', (ctx) => {
  const d = read(ctx);
  const { q, active } = listParams(ctx);
  let rows = byCreatedDesc(d.campaigns);
  if (active !== undefined) rows = rows.filter((r) => r.is_active === active);
  const page = paginate(search(rows, q, ['name']), ctx.query, 20);
  return { ...page, items: page.items.map(campaignView) };
});

route('POST', '/v1/tenant/loyalty/campaigns', (ctx) => {
  const d = write(ctx);
  const at = now();
  const row: CampaignRow = { _org: ctx.orgUuid!, uuid: uuid(), created_at: at, updated_at: at, ...campaignFields(ctx.body) };
  d.s.campaigns.push(row);
  return campaignView(row);
});

route('PUT', '/v1/tenant/loyalty/campaigns/:uuid', (ctx) => {
  const row = found(write(ctx).campaigns, ctx.params.uuid, 'Campaign');
  Object.assign(row, campaignFields(ctx.body), { updated_at: now() });
  return campaignView(row);
});

route('DELETE', '/v1/tenant/loyalty/campaigns/:uuid', (ctx) => {
  const row = found(write(ctx).campaigns, ctx.params.uuid, 'Campaign');
  row.deleted = true;
  row.is_active = false;
  return { deleted: true };
});

// ─── Package definitions ───────────────────────────────────────────────────

function packageFields(b: Record<string, unknown>) {
  const items = Array.isArray(b.items) ? (b.items as { service_uuid?: unknown; quantity?: unknown }[]) : [];
  if (items.length < 1 || items.length > 50) invalid('a package needs 1 to 50 services');
  const seen = new Set<string>();
  const parsed = items.map((it) => {
    const q = Number(it.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 1000) invalid('quantity must be between 1 and 1000');
    const id = str(it.service_uuid);
    if (seen.has(id)) invalid('a service is listed twice');
    seen.add(id);
    serviceRefs([id]);
    return { service_uuid: id, quantity: q };
  });
  return {
    name: name(b.name),
    description: str(b.description).trim().slice(0, 1000),
    price: positiveMoney(b.price, 'price'),
    currency: currency(b.currency),
    validity_days: optInt(b.validity_days, 1, 3650, 'validity_days must be between 1 and 3650'),
    is_active: b.is_active === undefined ? true : Boolean(b.is_active),
    items: parsed,
  };
}

route('GET', '/v1/tenant/loyalty/packages', (ctx) => {
  const d = read(ctx);
  const { q, active } = listParams(ctx);
  let rows = byCreatedDesc(d.packages);
  if (active !== undefined) rows = rows.filter((r) => r.is_active === active);
  const page = paginate(search(rows, q, ['name']), ctx.query, 20);
  return { ...page, items: page.items.map((r) => packageView(ctx.orgUuid!, r)) };
});

route('POST', '/v1/tenant/loyalty/packages', (ctx) => {
  const d = write(ctx);
  const at = now();
  const row: PackageRow = { _org: ctx.orgUuid!, uuid: uuid(), created_at: at, updated_at: at, ...packageFields(ctx.body) };
  d.s.packages.push(row);
  return packageView(ctx.orgUuid!, row);
});

route('PUT', '/v1/tenant/loyalty/packages/:uuid', (ctx) => {
  const row = found(write(ctx).packages, ctx.params.uuid, 'Package');
  Object.assign(row, packageFields(ctx.body), { updated_at: now() });
  return packageView(ctx.orgUuid!, row);
});

route('DELETE', '/v1/tenant/loyalty/packages/:uuid', (ctx) => {
  const row = found(write(ctx).packages, ctx.params.uuid, 'Package');
  row.deleted = true;
  row.is_active = false;
  return { deleted: true };
});

// ─── Subscription plans ────────────────────────────────────────────────────

function planFields(b: Record<string, unknown>) {
  const months = Number(b.period_months);
  if (!Number.isInteger(months) || months < 1 || months > 12) invalid('period_months must be between 1 and 12');
  const services = uuidList(b.service_uuids);
  const categories = uuidList(b.category_uuids);
  serviceRefs(services);
  categoryRefs(categories);
  if (!services.length && !categories.length) invalid('choose at least one eligible service or category');
  return {
    name: name(b.name),
    description: str(b.description).trim().slice(0, 1000),
    price: positiveMoney(b.price, 'price'),
    currency: currency(b.currency),
    period_months: months,
    uses_per_period: optInt(b.uses_per_period, 1, 1000, 'uses_per_period must be between 1 and 1000 (omit for unlimited)'),
    service_uuids: services,
    category_uuids: categories,
    is_active: b.is_active === undefined ? true : Boolean(b.is_active),
  };
}

route('GET', '/v1/tenant/loyalty/plans', (ctx) => {
  const d = read(ctx);
  const { q, active } = listParams(ctx);
  let rows = byCreatedDesc(d.plans);
  if (active !== undefined) rows = rows.filter((r) => r.is_active === active);
  const page = paginate(search(rows, q, ['name']), ctx.query, 20);
  return { ...page, items: page.items.map((r) => planView(ctx.orgUuid!, r)) };
});

route('POST', '/v1/tenant/loyalty/plans', (ctx) => {
  const d = write(ctx);
  const at = now();
  const row: PlanRow = { _org: ctx.orgUuid!, uuid: uuid(), created_at: at, updated_at: at, ...planFields(ctx.body) };
  d.s.plans.push(row);
  return planView(ctx.orgUuid!, row);
});

route('PUT', '/v1/tenant/loyalty/plans/:uuid', (ctx) => {
  const row = found(write(ctx).plans, ctx.params.uuid, 'Plan');
  Object.assign(row, planFields(ctx.body), { updated_at: now() });
  return planView(ctx.orgUuid!, row);
});

route('DELETE', '/v1/tenant/loyalty/plans/:uuid', (ctx) => {
  const row = found(write(ctx).plans, ctx.params.uuid, 'Plan');
  row.deleted = true;
  row.is_active = false;
  return { deleted: true };
});

// ─── Packages sold ─────────────────────────────────────────────────────────

route('GET', '/v1/tenant/loyalty/customer-packages', (ctx) => {
  const d = read(ctx);
  const customer = uuidQuery(ctx, 'customer_uuid');
  const state = ctx.query.state;
  if (state && !['active', 'expired', 'used_up', 'cancelled'].includes(state)) invalid('state must be active, expired, used_up or cancelled');
  let rows = byCreatedDesc(d.customerPackages.map((r) => ({ ...r, created_at: r.purchased_at })));
  if (customer) rows = rows.filter((r) => r.customer_uuid === customer);
  if (state) rows = rows.filter((r) => packageState(r) === state);
  rows = search(rows, ctx.query.q, ['name', (r) => customerOf(r.customer_uuid)?.name ?? '']);
  const page = paginate(rows, ctx.query, 20);
  return { ...page, items: page.items.map((r) => customerPackageView(d.customerPackages.find((x) => x.uuid === r.uuid)!)) };
});

route('POST', '/v1/tenant/loyalty/customer-packages', (ctx) => {
  const d = apply(ctx);
  const db = getDb();
  const b = ctx.body;
  if (!b.package_uuid || !b.customer_uuid) invalid('package_uuid and customer_uuid are required');
  const pkg = found(d.packages, str(b.package_uuid), 'Package');
  if (!pkg.is_active) conflict('package is not active');
  const cust = customerIn(ctx, str(b.customer_uuid));
  const at = now();
  const row: CustomerPackageRow = {
    _org: ctx.orgUuid!,
    uuid: uuid(),
    package_uuid: pkg.uuid,
    customer_uuid: cust.uuid,
    name: pkg.name,
    price: pkg.price,
    currency: pkg.currency,
    status: 'active',
    purchased_at: at,
    payment_method: 'cash',
    credits: pkg.items.map((it) => ({ service_uuid: it.service_uuid, service_name: db.services.find((x) => x.uuid === it.service_uuid)?.name ?? '', total: it.quantity, used: 0 })),
    notes: str(b.notes).trim().slice(0, 1000),
  };
  if (pkg.validity_days) row.expires_at = new Date(`${addDays(today(), pkg.validity_days + 1)}T00:00:00+03:00`).toISOString();
  const paid = collect(db, b, {
    customerUuid: cust.uuid,
    amount: num(pkg.price),
    category: CAT_PACKAGE,
    sourceType: SRC_PACKAGE,
    sourceUuid: row.uuid,
    description: `Paket satışı — ${pkg.name} (${cust.name})`,
  });
  row.payment_method = paid.method;
  row.cari_entry_uuid = paid.cariEntryUuid;
  d.s.customerPackages.push(row);
  return customerPackageDetail(row);
});

route('GET', '/v1/tenant/loyalty/customer-packages/:uuid', (ctx) => customerPackageDetail(found(read(ctx).customerPackages, ctx.params.uuid, 'Customer package')));

route('POST', '/v1/tenant/loyalty/customer-packages/:uuid/cancel', (ctx) => {
  const d = write(ctx);
  const db = getDb();
  const row = found(d.customerPackages, ctx.params.uuid, 'Customer package');
  const openUse = d.applications.some((a) => a.source_uuid === row.uuid && a.status === 'applied' && db.jobs.some((j) => j.uuid === a.job_uuid && j.payment_status === 'unpaid'));
  if (openUse) conflict('credits of this package are applied on open jobs; revert them first');
  if (row.status === 'cancelled') conflict('package is already cancelled');
  row.status = 'cancelled';
  row.cancelled_at = now();
  const refunded = row.credits.every((c) => c.used === 0);
  if (refunded) {
    if (row.payment_method === 'cari') {
      const entry = db.cariEntries.find((e) => e.uuid === row.cari_entry_uuid);
      if (entry && entry.status === 'posted') voidCariEntry(db, entry);
    } else voidFinanceBySource(db, SRC_PACKAGE, row.uuid);
  }
  return { ...customerPackageDetail(row), refunded };
});

// ─── Subscriptions ─────────────────────────────────────────────────────────

route('GET', '/v1/tenant/loyalty/subscriptions', (ctx) => {
  const d = read(ctx);
  const customer = uuidQuery(ctx, 'customer_uuid');
  const state = ctx.query.state;
  if (state && !['active', 'past_due', 'cancelled'].includes(state)) invalid('state must be active, past_due or cancelled');
  const day = today();
  let rows = byCreatedDesc(d.subscriptions);
  if (customer) rows = rows.filter((r) => r.customer_uuid === customer);
  if (state === 'cancelled') rows = rows.filter((r) => r.status === 'cancelled');
  if (state === 'active') rows = rows.filter((r) => r.status === 'active' && r.paid_through > day);
  if (state === 'past_due') rows = rows.filter((r) => r.status === 'active' && r.paid_through <= day);
  if (ctx.query.due_within_days !== undefined) {
    const n = Number(ctx.query.due_within_days);
    if (!Number.isInteger(n) || n < 0 || n > 365) invalid('due_within_days must be between 0 and 365');
    rows = rows.filter((r) => r.status === 'active' && r.paid_through <= addDays(day, n)).sort((a, b) => (a.paid_through < b.paid_through ? -1 : 1));
  }
  rows = search(rows, ctx.query.q, ['name', (r) => customerOf(r.customer_uuid)?.name ?? '', (r) => customerOf(r.customer_uuid)?.phone ?? '']);
  const page = paginate(rows, ctx.query, 20);
  return { ...page, items: page.items.map(subscriptionView) };
});

function paySubscription(db: MockDb, row: SubscriptionRow, body: Record<string, unknown>) {
  if (row.status === 'cancelled') conflict('subscription is cancelled');
  const [from, to] = nextPeriod(row);
  if (from > addDays(today(), 366)) conflict('subscription is already paid a year ahead');
  const cust = customerOf(row.customer_uuid);
  const payUuid = uuid();
  const paid = collect(db, body, {
    customerUuid: row.customer_uuid,
    amount: num(row.price),
    category: CAT_SUBSCRIPTION,
    sourceType: SRC_SUBSCRIPTION,
    sourceUuid: payUuid,
    description: `Abonelik — ${row.name} (${cust?.name ?? ''}) ${from} / ${to}`,
  });
  const pay: PaymentRow = {
    _org: row._org,
    uuid: payUuid,
    subscription_uuid: row.uuid,
    period_start: from,
    period_end: to,
    amount: row.price,
    currency: row.currency,
    method: paid.method,
    cari_entry_uuid: paid.cariEntryUuid,
    created_at: now(),
  };
  if (paid.accountName) pay.finance_account_name = paid.accountName;
  store().payments.push(pay);
  row.paid_through = to;
}

route('POST', '/v1/tenant/loyalty/subscriptions', (ctx) => {
  const d = apply(ctx);
  const db = getDb();
  const b = ctx.body;
  if (!b.plan_uuid || !b.customer_uuid) invalid('plan_uuid and customer_uuid are required');
  const plan = found(d.plans, str(b.plan_uuid), 'Plan');
  if (!plan.is_active) conflict('plan is not active');
  const cust = customerIn(ctx, str(b.customer_uuid));
  let vehicle: string | undefined;
  if (b.vehicle_uuid) {
    const v = db.vehicles.find((x) => x.uuid === b.vehicle_uuid);
    if (!v) invalid('vehicle not found');
    if (v!.customer_uuid !== cust.uuid) invalid('vehicle does not belong to customer');
    vehicle = v!.uuid;
  }
  const day = today();
  const start = parseDay(b.start_date, 'start_date') ?? day;
  if (start < addDays(day, -62) || start > addDays(day, 62)) invalid('start_date must be within 62 days of today');
  const row: SubscriptionRow = {
    _org: ctx.orgUuid!,
    uuid: uuid(),
    plan_uuid: plan.uuid,
    customer_uuid: cust.uuid,
    vehicle_uuid: vehicle,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    period_months: plan.period_months,
    uses_per_period: plan.uses_per_period,
    start_date: start,
    paid_through: start,
    status: 'active',
    notes: str(b.notes).trim().slice(0, 1000),
    created_at: now(),
  };
  const payment = b.payment && typeof b.payment === 'object' ? (b.payment as Record<string, unknown>) : null;
  if (payment) paySubscription(db, row, payment);
  d.s.subscriptions.push(row);
  return subscriptionDetail(row);
});

route('GET', '/v1/tenant/loyalty/subscriptions/:uuid', (ctx) => subscriptionDetail(found(read(ctx).subscriptions, ctx.params.uuid, 'Subscription')));

route('POST', '/v1/tenant/loyalty/subscriptions/:uuid/payments', (ctx) => {
  const row = found(apply(ctx).subscriptions, ctx.params.uuid, 'Subscription');
  paySubscription(getDb(), row, ctx.body);
  return subscriptionDetail(row);
});

route('POST', '/v1/tenant/loyalty/subscriptions/:uuid/cancel', (ctx) => {
  const row = found(write(ctx).subscriptions, ctx.params.uuid, 'Subscription');
  if (row.status === 'cancelled') conflict('subscription is already cancelled');
  row.status = 'cancelled';
  row.cancelled_at = now();
  return subscriptionDetail(row);
});

// ─── Customer 360 / job section ────────────────────────────────────────────

route('GET', '/v1/tenant/customers/:uuid/loyalty', (ctx) => {
  requirePerm(ctx, 'tenant.customers.read');
  const d = read(ctx);
  const cust = customerOf(ctx.params.uuid);
  if (!cust) notFound('Customer');
  const cards = plainCards(stampCards(ctx.orgUuid!, cust!.uuid));
  return {
    customer_uuid: cust!.uuid,
    stamps: cards,
    packages: byCreatedDesc(d.customerPackages.filter((p) => p.customer_uuid === cust!.uuid && packageState(p) === 'active').map((p) => ({ ...p, created_at: p.purchased_at }))).map((p) =>
      customerPackageView(d.customerPackages.find((x) => x.uuid === p.uuid)!),
    ),
    subscriptions: byCreatedDesc(d.subscriptions.filter((s) => s.customer_uuid === cust!.uuid && s.status === 'active')).map(subscriptionView),
    rewards_available: cards.reduce((s, c) => s + c.rewards_available, 0),
  };
});

function jobFor(ctx: MockCtx) {
  const job = getDb().jobs.find((j) => j.uuid === ctx.params.uuid && j._org === ctx.orgUuid);
  if (!job) notFound('Job');
  return job!;
}

route('GET', '/v1/tenant/jobs/:uuid/loyalty', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.read');
  read(ctx);
  return jobView(jobFor(ctx));
});

route('POST', '/v1/tenant/jobs/:uuid/loyalty/apply', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.write');
  const d = apply(ctx);
  const kind = str(ctx.body.kind) as Kind;
  if (!['reward', 'package', 'subscription'].includes(kind)) invalid('kind must be reward, package or subscription');
  const source = str(ctx.body.source_uuid);
  const lineUuid = str(ctx.body.line_uuid);
  if (!source || !lineUuid) invalid('source_uuid and line_uuid are required');
  const job = jobFor(ctx);
  if (!editable(job)) conflict('loyalty can only change on an open, unpaid job');
  const line = job.lines.find((l) => l.uuid === lineUuid);
  if (!line) invalid('line not found on this job');
  if (line!.discount_source) conflict('this line is already covered; revert it first');
  const cards = stampCards(job._org, job.customer_uuid);
  const opt = options(job, cards).find((o) => o.kind === kind && o.source_uuid === source && o.line_uuid === lineUuid);
  if (!opt) notApplicable(`this ${kind} does not cover that line (or nothing is left)`);
  const app: ApplicationRow = {
    _org: job._org,
    uuid: uuid(),
    job_uuid: job.uuid,
    line_uuid: line!.uuid,
    customer_uuid: job.customer_uuid,
    kind,
    source_uuid: source,
    source_name: opt!.source_name,
    line_name: line!.name,
    units: opt!.units,
    discount_amount: opt!.discount_amount,
    status: 'applied',
    created_at: now(),
  };
  if (kind === 'reward') {
    const c = cards.find((x) => x.campaign_uuid === source)!._c;
    app.units = c.stamps_required;
    d.s.stamps.push({ _org: job._org, campaign_uuid: c.uuid, customer_uuid: job.customer_uuid, job_uuid: job.uuid, kind: 'redeem', stamps: -c.stamps_required, at: now() });
  } else if (kind === 'package') {
    const credit = d.customerPackages.find((p) => p.uuid === source)?.credits.find((c) => c.service_uuid === line!.service_uuid);
    if (!credit || credit.total - credit.used < opt!.units) notApplicable('no credit left');
    credit!.used += opt!.units;
    app.credit_service_uuid = credit!.service_uuid;
  } else {
    const sub = d.subscriptions.find((s) => s.uuid === source)!;
    app.period_start = periodBounds(sub.start_date, sub.period_months, periodIndex(sub.start_date, sub.period_months, today()))[0];
  }
  d.s.applications.push(app);
  setLineDiscount(line!, num(opt!.discount_amount), kind);
  recalcTotal(job);
  return jobView(job);
});

route('POST', '/v1/tenant/jobs/:uuid/loyalty/:applicationUuid/revert', (ctx) => {
  requirePerm(ctx, 'tenant.jobs.write');
  const d = apply(ctx);
  const job = jobFor(ctx);
  const app = d.applications.find((a) => a.uuid === ctx.params.applicationUuid && a.job_uuid === job.uuid);
  if (!app) notFound('Application');
  if (app!.status !== 'applied') conflict('already reverted');
  if (!editable(job)) conflict('loyalty can only change on an open, unpaid job');
  revertApplication(app!, true, job);
  recalcTotal(job);
  return jobView(job);
});

// ─── Seed ──────────────────────────────────────────────────────────────────

/**
 * Demo programs for an organization: a wash stamp card, a percent campaign, two packages and two plans; the
 * customer of the first open job holds a package covering that job's service and three stamps, and two other
 * customers have subscriptions (one renews in a few days, one is past due).
 */
function seed(s: Store, org: string) {
  const db = getDb();
  const at = db.seededAt ?? now();
  const svc = (code: string) => db.services.find((x) => x.code === code);
  const cat = (n: string) => db.catalogCategories.find((c) => c.name === n && c.kind === 'service');
  const full = svc('YKM-02');
  const exterior = svc('YKM-01');
  const interior = svc('DTL-01');
  const wash = cat('Yıkama');
  const detail = cat('Detailing');
  if (!full || !exterior || !wash) return;
  const day = today();
  const base = { _org: org, created_at: at, updated_at: at };

  const card: CampaignRow = {
    ...base,
    uuid: uuid(),
    name: '5 yıkamaya 1 iç-dış yıkama bedava',
    description: 'Her yıkamada bir damga; beşinci damgada iç-dış yıkama hediye.',
    service_uuids: [],
    category_uuids: [wash.uuid],
    stamps_required: 5,
    reward_type: 'free_service',
    reward_service_uuid: full.uuid,
    reward_value: '0.00',
    is_active: true,
  };
  s.campaigns.push(card);
  if (detail) {
    s.campaigns.push({
      ...base,
      uuid: uuid(),
      name: 'Detailing sadakati: 3 işleme %20',
      description: '',
      service_uuids: [],
      category_uuids: [detail.uuid],
      stamps_required: 3,
      reward_type: 'percent',
      reward_value: '20.00',
      is_active: true,
      per_customer_limit: 2,
    });
  }
  const pack: PackageRow = {
    ...base,
    uuid: uuid(),
    name: '10 iç-dış yıkama paketi',
    description: '10 iç-dış yıkama, 180 gün geçerli.',
    price: money(num(full.price) * 8),
    currency: 'TRY',
    validity_days: 180,
    is_active: true,
    items: [{ service_uuid: full.uuid, quantity: 10 }],
  };
  s.packages.push(pack);
  if (interior) {
    s.packages.push({
      ...base,
      uuid: uuid(),
      name: 'Bakım paketi',
      description: '',
      price: money(num(interior.price) * 2 + num(exterior.price) * 3),
      currency: 'TRY',
      is_active: true,
      items: [
        { service_uuid: interior.uuid, quantity: 3 },
        { service_uuid: exterior.uuid, quantity: 4 },
      ],
    });
  }
  const unlimited: PlanRow = {
    ...base,
    uuid: uuid(),
    name: 'Aylık sınırsız yıkama',
    description: 'Yıkama hizmetlerinde ay boyunca sınırsız kullanım.',
    price: '1500.00',
    currency: 'TRY',
    period_months: 1,
    service_uuids: [],
    category_uuids: [wash.uuid],
    is_active: true,
  };
  const monthly4: PlanRow = {
    ...base,
    uuid: uuid(),
    name: 'Ayda 4 dış yıkama',
    description: '',
    price: '800.00',
    currency: 'TRY',
    period_months: 1,
    uses_per_period: 4,
    service_uuids: [exterior.uuid],
    category_uuids: [],
    is_active: true,
  };
  s.plans.push(unlimited, monthly4);

  const jobs = db.jobs.filter((j) => j._org === org);
  const open = jobs.find((j) => j.payment_status === 'unpaid' && j.status === 'in_progress' && j.lines.some((l) => l.service_uuid));
  const customers = [...new Set(jobs.map((j) => j.customer_uuid))];
  const holder = open?.customer_uuid ?? customers[0];
  if (holder) {
    const line = open?.lines.find((l) => l.service_uuid);
    const lineSvc = (line && db.services.find((x) => x.uuid === line.service_uuid)) || full;
    s.customerPackages.push({
      _org: org,
      uuid: uuid(),
      package_uuid: lineSvc.uuid === full.uuid ? pack.uuid : undefined,
      customer_uuid: holder,
      name: lineSvc.uuid === full.uuid ? pack.name : `5 × ${lineSvc.name}`,
      price: money(num(lineSvc.price) * 4),
      currency: 'TRY',
      status: 'active',
      purchased_at: new Date(Date.now() - 20 * 86400000).toISOString(),
      expires_at: new Date(Date.now() + 160 * 86400000).toISOString(),
      payment_method: 'cash',
      credits: [{ service_uuid: lineSvc.uuid, service_name: lineSvc.name, total: lineSvc.uuid === full.uuid ? 10 : 5, used: 2 }],
      notes: '',
    });
    for (let i = 0; i < 3; i++) s.stamps.push({ _org: org, campaign_uuid: card.uuid, customer_uuid: holder, kind: 'earn', stamps: 1, at });
  }
  const others = customers.filter((c) => c !== holder);
  const sub = (customerUuid: string, plan: PlanRow, startOffset: number) => {
    const start = addDays(day, startOffset);
    const row: SubscriptionRow = {
      _org: org,
      uuid: uuid(),
      plan_uuid: plan.uuid,
      customer_uuid: customerUuid,
      name: plan.name,
      price: plan.price,
      currency: plan.currency,
      period_months: plan.period_months,
      uses_per_period: plan.uses_per_period,
      start_date: start,
      paid_through: addMonths(start, plan.period_months),
      status: 'active',
      notes: '',
      created_at: new Date(`${start}T09:00:00+03:00`).toISOString(),
    };
    s.subscriptions.push(row);
    s.payments.push({
      _org: org,
      uuid: uuid(),
      subscription_uuid: row.uuid,
      period_start: start,
      period_end: row.paid_through,
      amount: plan.price,
      currency: plan.currency,
      method: 'card',
      created_at: row.created_at,
    });
  };
  if (others[0]) sub(others[0], unlimited, -28);
  if (others[1]) sub(others[1], monthly4, -40);
}
