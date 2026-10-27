/**
 * Review collection (`/v1/tenant/reviews/*`, backend `modules/reviews`): settings, the request list with the
 * same filters, the KPI summary, follow-up ("ele alındı") and the test send. Requests are seeded per
 * organization from its delivered jobs, and a newly delivered job schedules one (`scheduleReviewForJob`,
 * called by the jobs mock), like the `jobs.delivered` handler on the Go API. Same validation, owner rule and
 * plan gate (`reviews.enabled` via billing's GATED_PREFIXES) as the use case.
 */
import type { components } from '@/api/generated/api';

import { fail, istanbulDay, notFound, now, paginate, requireOwner, requirePerm, resourceMeta, route, search, sortBy, str, uuid, uuidQuery, type MockCtx } from '../core';
import { getDb } from '../db';

type Schemas = components['schemas'];
type ReviewDetail = Schemas['ReviewDetail'];
type ReviewSettings = Schemas['ReviewSettings'];
type Row = ReviewDetail & { _org: string; _token: string };
type SettingsRow = Omit<ReviewSettings, 'whatsapp_available' | 'sms_available' | 'effective_channel' | 'template' | 'usage'>;

const READ = 'tenant.reviews.read';
const WRITE = 'tenant.reviews.write';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const STATUSES = ['scheduled', 'sent', 'opened', 'answered', 'expired', 'cancelled', 'skipped', 'failed'] as const;
const SORTS = new Set(['', '-created_at', 'created_at', 'score', '-score', 'answered_at', '-answered_at']);

const rows: Row[] = [];
const settings = new Map<string, SettingsRow>();
const seeded = new Set<string>();

const invalid = (message: string, field?: string): never => fail(400, 'VALIDATION_ERROR', message, [{ field, message }]);
const iso = (ms: number) => new Date(ms).toISOString();
const token = () => uuid().replace(/-/g, '').slice(0, 22);

function defaults(): SettingsRow {
  return {
    enabled: true,
    channel: 'auto',
    delay_minutes: 120,
    quiet_hours_enabled: true,
    quiet_start_hour: 21,
    quiet_end_hour: 9,
    google_review_url: 'https://g.page/r/otopoly-demo/review',
    high_score_threshold: 4,
    min_days_between: 30,
    consent_text: '',
    default_locale: 'tr',
    excluded_customers: [],
  };
}

const settingsOf = (org: string) => {
  let s = settings.get(org);
  if (!s) {
    s = defaults();
    settings.set(org, s);
  }
  return s;
};

/** Backend `QuietUntil` in Europe/Istanbul (UTC+3 all year). */
export function quietUntil(at: Date, start: number, end: number): { at: Date; deferred: boolean } {
  if (start === end) return { at, deferred: false };
  const local = new Date(at.getTime() + 3 * HOUR);
  const h = local.getUTCHours();
  const endOn = (offsetDays: number) => {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offsetDays, end, 0, 0));
    return new Date(d.getTime() - 3 * HOUR);
  };
  if (start > end) {
    if (h >= start) return { at: endOn(1), deferred: true };
    if (h < end) return { at: endOn(0), deferred: true };
    return { at, deferred: false };
  }
  if (h >= start && h < end) return { at: endOn(0), deferred: true };
  return { at, deferred: false };
}

function blank(org: string, job: { uuid: string; customer_uuid?: string | null; customer_name?: string; customer_phone?: string; plate?: string }, createdMs: number): Row {
  const ts = iso(createdMs);
  return {
    _org: org,
    _token: token(),
    uuid: uuid(),
    kind: 'job',
    status: 'scheduled',
    skip_reason: '',
    error: '',
    channel: '',
    locale: 'tr',
    customer_uuid: job.customer_uuid ?? null,
    customer_name: job.customer_name ?? '',
    customer_phone: job.customer_phone ?? '',
    job_uuid: job.uuid,
    plate: job.plate ?? '',
    score: null,
    comment: '',
    rating: '',
    google_redirects: 0,
    follow_up_status: 'none',
    follow_up_note: '',
    followed_up_at: null,
    followed_up_by_name: '',
    send_at: iso(createdMs + 2 * HOUR),
    deferred: false,
    sent_at: null,
    opened_at: null,
    answered_at: null,
    expires_at: null,
    created_at: ts,
    updated_at: ts,
    consent: false,
    view_count: 0,
    google_redirected_at: null,
    cancelled_at: null,
  };
}

function markSent(r: Row, sentMs: number, channel: 'whatsapp' | 'sms') {
  r.status = 'sent';
  r.channel = channel;
  r.sent_at = iso(sentMs);
  r.send_at = r.sent_at;
  r.expires_at = iso(sentMs + 30 * DAY);
}

function answer(r: Row, score: number, comment: string, atMs: number, threshold: number) {
  r.status = 'answered';
  r.score = score;
  r.comment = comment;
  r.opened_at ??= iso(atMs - 5 * 60000);
  r.answered_at = iso(atMs);
  r.view_count = Math.max(1, r.view_count);
  const high = score >= threshold;
  r.rating = high ? 'high' : 'low';
  r.follow_up_status = high || r.kind === 'test' ? 'none' : 'required';
  r.updated_at = r.answered_at;
}

const COMMENTS_HIGH = ['Çok memnun kaldım, araç tertemiz teslim edildi.', 'Hızlı ve özenli hizmet, teşekkürler!', 'Seramik kaplama harika oldu.', ''];
const COMMENTS_LOW = ['Araç söylenen saatten geç teslim edildi.', 'İç temizlikte koltuk altları unutulmuş.'];

/** A realistic month: answered (mostly happy, two needing a follow-up), open, expired, skipped and scheduled. */
function seed(org: string) {
  if (seeded.has(org)) return;
  seeded.add(org);
  const s = settingsOf(org);
  const jobs = getDb()
    .jobs.filter((j) => j._org === org)
    .slice(0, 14);
  const base = Date.now();
  jobs.forEach((job, i) => {
    const created = base - (i * 2 + 1) * DAY - 5 * HOUR;
    const r = blank(org, job, created);
    const sent = created + 2 * HOUR;
    if (i === 0) {
      r.send_at = iso(base + HOUR);
    } else if (i === 9) {
      r.status = 'skipped';
      r.skip_reason = 'frequency_cap';
    } else if (i === 10) {
      r.status = 'cancelled';
      r.skip_reason = 'job_cancelled';
      r.cancelled_at = iso(created + HOUR);
    } else {
      markSent(r, sent, i % 4 === 3 ? 'sms' : 'whatsapp');
      if (i === 1 || i === 6) {
        answer(r, i === 1 ? 2 : 3, COMMENTS_LOW[i === 1 ? 0 : 1], sent + 3 * HOUR, s.high_score_threshold);
      } else if (i === 8) {
        r.status = 'opened';
        r.opened_at = iso(sent + HOUR);
        r.view_count = 1;
      } else if (i === 11) {
        r.status = 'expired';
      } else if (i !== 12) {
        answer(r, i % 3 === 0 ? 4 : 5, COMMENTS_HIGH[i % COMMENTS_HIGH.length], sent + 2 * HOUR, s.high_score_threshold);
        if (i % 2 === 0) {
          r.google_redirects = 1;
          r.google_redirected_at = iso(sent + 2 * HOUR + 60000);
        }
      }
    }
    if (i === 6 && r.status === 'answered') {
      r.follow_up_status = 'done';
      r.follow_up_note = 'Müşteri arandı, iç temizlik yeniden yapıldı.';
      r.followed_up_at = iso(sent + 5 * HOUR);
      r.followed_up_by_name = 'Demo Kullanıcı';
    }
    rows.push(r);
  });
}

const orgRows = (ctx: MockCtx) => {
  seed(ctx.orgUuid!);
  return rows.filter((r) => r._org === ctx.orgUuid);
};

const view = (r: Row): ReviewDetail => {
  const { _org: _o, _token: _t, ...rest } = r;
  return rest;
};

/** `reviews.monthly` usage: job requests sent this month (billing meters). */
export function reviewsSentThisMonth(org: string) {
  if (!org) return 0;
  seed(org);
  const month = istanbulDay().slice(0, 7);
  return rows.filter((r) => r._org === org && r.kind === 'job' && r.sent_at && istanbulDay(r.sent_at).slice(0, 7) === month).length;
}

/** Called by the jobs mock when a job is delivered: one scheduled request per job (idempotent). */
export function scheduleReviewForJob(org: string, job: { uuid: string; customer_uuid?: string | null; customer_name?: string; customer_phone?: string; plate?: string; delivered_at?: string | null }) {
  seed(org);
  const s = settingsOf(org);
  if (!s.enabled || rows.some((r) => r._org === org && r.job_uuid === job.uuid)) return;
  const delivered = job.delivered_at ? new Date(job.delivered_at).getTime() : Date.now();
  const r = blank(org, job, Date.now());
  const planned = new Date(delivered + s.delay_minutes * 60000);
  const q = s.quiet_hours_enabled ? quietUntil(planned, s.quiet_start_hour, s.quiet_end_hour) : { at: planned, deferred: false };
  r.send_at = q.at.toISOString();
  r.deferred = q.deferred;
  r.locale = s.default_locale;
  rows.push(r);
}

/** Cancels the unsent request of a cancelled / voided job. */
export function cancelReviewForJob(org: string, jobUuid: string) {
  for (const r of rows) {
    if (r._org === org && r.job_uuid === jobUuid && r.status === 'scheduled') {
      r.status = 'cancelled';
      r.skip_reason = 'job_cancelled';
      r.cancelled_at = now();
      r.updated_at = r.cancelled_at;
    }
  }
}

function settingsView(ctx: MockCtx): ReviewSettings {
  const s = settingsOf(ctx.orgUuid!);
  const org = getDb().organizations.find((o) => o.uuid === ctx.orgUuid);
  const channel = s.channel === 'sms' ? 'sms' : 'whatsapp';
  const body =
    s.default_locale === 'en'
      ? 'Hi {{musteri_adi}},\n\nThank you for choosing {{isletme_adi}}. Could you take a minute to rate our service?\n{{link}}'
      : 'Merhaba {{musteri_adi}},\n\n{{isletme_adi}} olarak bizi tercih ettiğiniz için teşekkür ederiz. Hizmetimizi 1 dakikada değerlendirir misiniz?\n{{link}}';
  const preview = body
    .replace('{{musteri_adi}}', s.default_locale === 'en' ? 'John Smith' : 'Ahmet Yılmaz')
    .replace('{{isletme_adi}}', org?.name ?? '')
    .replace('{{link}}', 'https://otopoly.app/r/AbCdEfGhIjKlMnOpQrStUv');
  return {
    ...s,
    whatsapp_available: true,
    sms_available: true,
    effective_channel: channel,
    template: { channel, locale: s.default_locale, body, is_custom: false, active: true, preview },
    usage: { used: reviewsSentThisMonth(ctx.orgUuid!), limit: 300 },
  };
}

const int = (v: unknown, field: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) invalid(`${field} must be between ${min} and ${max}`, field);
  return v as number;
};

route('GET', '/v1/tenant/reviews/meta', (ctx) => {
  requirePerm(ctx, READ);
  return resourceMeta('tenant.reviews', '-created_at', { read: true, update: true, search: true, filter: true, sort: true }, {
    searchable: ['customer_name', 'customer_phone', 'plate', 'comment'],
    sortable: ['created_at', 'score', 'answered_at'],
    filterable: ['status', 'follow_up', 'rating', 'score', 'channel', 'customer_uuid', 'days'],
  });
});

route('GET', '/v1/tenant/reviews/summary', (ctx) => {
  requirePerm(ctx, READ);
  const days = ctx.query.days ? Number(ctx.query.days) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 730) invalid('days must be between 1 and 730', 'days');
  const since = Date.now() - days * DAY;
  const list = orgRows(ctx).filter((r) => r.kind === 'job' && new Date(r.created_at).getTime() >= since);
  const sent = list.filter((r) => ['sent', 'opened', 'answered', 'expired'].includes(r.status));
  const answered = list.filter((r) => r.status === 'answered' && r.score);
  const dist = [1, 2, 3, 4, 5].map((score) => ({ score, count: answered.filter((r) => r.score === score).length }));
  const promoters = dist[4].count;
  const passives = dist[3].count;
  const detractors = dist[0].count + dist[1].count + dist[2].count;
  const avg = answered.length ? Math.round((answered.reduce((a, r) => a + (r.score ?? 0), 0) / answered.length) * 10) / 10 : 0;
  const bucket = days > 120 ? 'month' : 'week';
  const buckets = new Map<string, { sent: number; answered: number; sum: number }>();
  for (const r of list) {
    const d = new Date(new Date(r.created_at).getTime() + 3 * HOUR);
    let key: string;
    if (bucket === 'month') key = `${d.toISOString().slice(0, 7)}-01`;
    else {
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
      key = monday.toISOString().slice(0, 10);
    }
    const b = buckets.get(key) ?? { sent: 0, answered: 0, sum: 0 };
    if (['sent', 'opened', 'answered', 'expired'].includes(r.status)) b.sent++;
    if (r.status === 'answered') {
      b.answered++;
      b.sum += r.score ?? 0;
    }
    buckets.set(key, b);
  }
  return {
    days,
    bucket,
    sent_count: sent.length,
    opened_count: list.filter((r) => r.opened_at).length,
    answered_count: answered.length,
    scheduled_count: list.filter((r) => r.status === 'scheduled').length,
    response_rate: sent.length ? Math.round((answered.length / sent.length) * 1000) / 1000 : 0,
    average_score: avg,
    distribution: dist,
    promoters,
    passives,
    detractors,
    nps: answered.length ? Math.round(((promoters - detractors) / answered.length) * 100) : 0,
    google_redirects: list.reduce((a, r) => a + r.google_redirects, 0),
    follow_up_required: list.filter((r) => r.follow_up_status === 'required').length,
    trend: [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([period_start, b]) => ({ period_start, sent: b.sent, answered: b.answered, average_score: b.answered ? Math.round((b.sum / b.answered) * 10) / 10 : 0 })),
  };
});

route('GET', '/v1/tenant/reviews/settings', (ctx) => {
  requirePerm(ctx, READ);
  seed(ctx.orgUuid!);
  return settingsView(ctx);
});

route('PUT', '/v1/tenant/reviews/settings', (ctx) => {
  requireOwner(ctx, WRITE);
  const s = settingsOf(ctx.orgUuid!);
  const b = ctx.body;
  const next = { ...s };
  if (b.enabled != null) next.enabled = b.enabled === true;
  if (b.channel != null) {
    if (!['auto', 'sms', 'whatsapp'].includes(str(b.channel))) invalid('channel must be auto, sms or whatsapp', 'channel');
    next.channel = str(b.channel) as SettingsRow['channel'];
  }
  if (b.delay_minutes != null) next.delay_minutes = int(b.delay_minutes, 'delay_minutes', 30, 2880);
  if (b.quiet_hours_enabled != null) next.quiet_hours_enabled = b.quiet_hours_enabled === true;
  if (b.quiet_start_hour != null) next.quiet_start_hour = int(b.quiet_start_hour, 'quiet_start_hour', 0, 23);
  if (b.quiet_end_hour != null) next.quiet_end_hour = int(b.quiet_end_hour, 'quiet_end_hour', 0, 23);
  if (b.google_review_url != null) {
    const u = str(b.google_review_url).trim();
    if (u && (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(u) || u.length > 500)) invalid('google_review_url must be an https link', 'google_review_url');
    next.google_review_url = u;
  }
  if (b.high_score_threshold != null) next.high_score_threshold = int(b.high_score_threshold, 'high_score_threshold', 2, 5);
  if (b.min_days_between != null) next.min_days_between = int(b.min_days_between, 'min_days_between', 0, 365);
  if (b.consent_text != null) {
    const c = str(b.consent_text).trim();
    if ([...c].length > 500) invalid('consent_text is too long', 'consent_text');
    next.consent_text = c;
  }
  if (b.default_locale != null) {
    if (!['tr', 'en'].includes(str(b.default_locale))) invalid('default_locale must be tr or en', 'default_locale');
    next.default_locale = str(b.default_locale) as 'tr' | 'en';
  }
  if (b.excluded_customer_uuids != null) {
    const ids = Array.isArray(b.excluded_customer_uuids) ? (b.excluded_customer_uuids as unknown[]).map(String) : invalid('excluded_customer_uuids must be a list');
    const customers = getDb().customers;
    next.excluded_customers = [...new Set(ids)].map((id) => {
      const c = customers.find((x) => x.uuid === id);
      return c ? { uuid: c.uuid, name: c.name, phone: c.phone } : invalid('unknown customer in excluded_customer_uuids', 'excluded_customer_uuids');
    });
  }
  settings.set(ctx.orgUuid!, next);
  return settingsView(ctx);
});

route('POST', '/v1/tenant/reviews/settings/test', (ctx) => {
  requireOwner(ctx, WRITE);
  seed(ctx.orgUuid!);
  const phone = str(ctx.body.phone).trim() || '+90 555 000 11 22';
  if ((phone.match(/\d/g) ?? []).length < 7 || phone.length > 32) invalid('phone is invalid', 'phone');
  const s = settingsOf(ctx.orgUuid!);
  const r = blank(ctx.orgUuid!, { uuid: '', customer_name: s.default_locale === 'tr' ? 'Test Müşteri' : 'Test', customer_phone: phone }, Date.now());
  r.kind = 'test';
  r.job_uuid = null;
  r.locale = s.default_locale;
  markSent(r, Date.now(), s.channel === 'sms' ? 'sms' : 'whatsapp');
  const url = `https://otopoly.app/r/${r._token}`;
  r.public_url = url;
  rows.push(r);
  return { review: view(r), channel: r.channel, phone, public_url: url };
});

route('GET', '/v1/tenant/reviews', (ctx) => {
  requirePerm(ctx, READ);
  const q = ctx.query;
  const status = q.status ?? '';
  if (status && !(STATUSES as readonly string[]).includes(status)) invalid('unknown status', 'status');
  if (q.follow_up && !['none', 'required', 'done'].includes(q.follow_up)) invalid('follow_up must be none, required or done', 'follow_up');
  if (q.rating && !['high', 'low'].includes(q.rating)) invalid('rating must be high or low', 'rating');
  if (q.channel && !['sms', 'whatsapp'].includes(q.channel)) invalid('channel must be sms or whatsapp', 'channel');
  if (!SORTS.has(q.sort ?? '')) invalid('unknown sort', 'sort');
  const customer = uuidQuery(ctx, 'customer_uuid');
  const days = q.days ? Number(q.days) : 0;
  const score = q.score ? Number(q.score) : 0;
  let list = orgRows(ctx).filter((r) => q.include_tests === 'true' || r.kind === 'job');
  if (status) list = list.filter((r) => r.status === status);
  if (q.follow_up) list = list.filter((r) => r.follow_up_status === q.follow_up);
  if (q.rating) list = list.filter((r) => r.rating === q.rating);
  if (score) list = list.filter((r) => r.score === score);
  if (q.channel) list = list.filter((r) => r.channel === q.channel);
  if (customer) list = list.filter((r) => r.customer_uuid === customer);
  if (days > 0) list = list.filter((r) => new Date(r.created_at).getTime() >= Date.now() - days * DAY);
  list = search(list, q.q, ['customer_name', 'customer_phone', 'plate', 'comment']);
  const page = paginate(sortBy(list, q.sort, '-created_at'), q);
  return { ...page, items: page.items.map((r) => { const { consent: _c, view_count: _v, google_redirected_at: _g, cancelled_at: _x, public_url: _p, ...rest } = view(r); return rest; }) };
});

route('GET', '/v1/tenant/reviews/:uuid', (ctx) => {
  requirePerm(ctx, READ);
  const r = orgRows(ctx).find((x) => x.uuid === ctx.params.uuid) ?? notFound('Review');
  return view(r);
});

route('POST', '/v1/tenant/reviews/:uuid/follow-up', (ctx) => {
  requireOwner(ctx, WRITE);
  const r = orgRows(ctx).find((x) => x.uuid === ctx.params.uuid) ?? notFound('Review');
  if (r.status !== 'answered') fail(409, 'CONFLICT', 'only answered reviews can be followed up');
  const note = str(ctx.body.note).trim();
  if ([...note].length > 1000) invalid('note is too long', 'note');
  const me = ctx.user;
  r.follow_up_status = 'done';
  r.follow_up_note = note;
  r.followed_up_at = now();
  r.followed_up_by_name = me ? `${me.name} ${me.surname}`.trim() : '';
  r.updated_at = r.followed_up_at;
  return view(r);
});

// Demo helper for the smoke suite: the customer answers through the public page.
export function answerForDemo(org: string, reviewUuid: string, score: number, comment = '') {
  const r = rows.find((x) => x._org === org && x.uuid === reviewUuid);
  if (!r || (r.status !== 'sent' && r.status !== 'opened')) return false;
  answer(r, score, comment, Date.now(), settingsOf(org).high_score_threshold);
  return true;
}

/** A seeded low score waiting for a follow-up (mock inbox notification target). */
export function followUpReviewUuid(org: string) {
  seed(org);
  return rows.find((r) => r._org === org && r.follow_up_status === 'required')?.uuid;
}

/** Widget alert: answered reviews waiting for a follow-up (backend WidgetReviewFollowUpCount). */
export function reviewFollowUpsDue(org: string) {
  if (!org) return 0;
  seed(org);
  return rows.filter((r) => r._org === org && r.kind === 'job' && r.follow_up_status === 'required').length;
}
