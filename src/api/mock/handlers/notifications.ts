/**
 * Notification inbox (`/v1/notifications*`) and Expo push devices (`/v1/push-devices`).
 * Contract: docs/backend/WAVE1_CONTRACTS.md and otopoly-go `feat/expo-push-limits` openapi.
 *
 * Each user's inbox is seeded lazily on first access with one notification of every kind the
 * backend sends to mobile (quote.team_*, todo.reminder, billing.*), plus older read ones so the
 * list paginates. Billing alerts only go to organization owners, like the backend.
 */
import type { NotificationPreferences } from '@/features/account/services/notification-preferences.service';
import type { AppNotification } from '@/features/notifications/services/notifications.service';
import type { PushDevice } from '@/features/notifications/services/push-devices.service';

import { fail, now, paginate, route, search, sortBy, str, uuid, validation, type MockCtx, type MockUser } from '../core';
import { getDb, type MockDb } from '../db';

type MockNotification = AppNotification & { _user: string };
type MockPushDevice = PushDevice & { _user: string; _disabled?: boolean };

type NotificationsExt = {
  _notifications?: MockNotification[];
  _notificationsSeeded?: string[];
  _pushDevices?: MockPushDevice[];
  _notificationPrefs?: Record<string, NotificationPreferences>;
};
const ext = () => getDb() as MockDb & NotificationsExt;

export const NOTIFICATION_KINDS = [
  'quote.team_created',
  'quote.team_expiring',
  'quote.team_accepted',
  'quote.team_rejected',
  'todo.reminder',
  'billing.usage_warning',
  'billing.limit_full',
  'billing.limit_reached',
  'billing.subscription_ending',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const SIGNED_TTL_S = 7 * 86400;
/** Mock signature: the real backend HMACs `{uuid}.{exp}`; here it only has to round-trip. */
const signFor = (id: string, exp: number) => `mock.${id}.${exp}`;

function userOf(ctx: MockCtx): MockUser {
  if (!ctx.user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  return ctx.user!;
}

// ─── Copy (lock-screen safe: no amounts, phone numbers or customer names) ──

type Copy = { title: string; body: string };
type Vars = { number?: string; todo?: string; feature?: string; used?: number; limit?: number; days?: number };

const FEATURE: Record<string, { tr: string; en: string }> = {
  jobs: { tr: 'iş emri', en: 'work order' },
  customers: { tr: 'müşteri', en: 'customer' },
  whatsapp: { tr: 'WhatsApp mesajı', en: 'WhatsApp message' },
};

function copyFor(kind: string, locale: string, v: Vars): Copy {
  const en = locale === 'en';
  const f = FEATURE[v.feature ?? 'jobs'] ?? FEATURE.jobs;
  switch (kind) {
    case 'quote.team_created':
      return en ? { title: 'New quote created', body: `Quote ${v.number} was created.` } : { title: 'Yeni teklif oluşturuldu', body: `${v.number} numaralı teklif oluşturuldu.` };
    case 'quote.team_expiring':
      return en ? { title: 'Quote expiring soon', body: `Quote ${v.number} expires in 2 days.` } : { title: 'Teklifin süresi doluyor', body: `${v.number} numaralı teklifin süresi 2 gün içinde doluyor.` };
    case 'quote.team_accepted':
      return en ? { title: 'Quote accepted', body: `Quote ${v.number} was accepted by the customer.` } : { title: 'Teklif kabul edildi', body: `${v.number} numaralı teklif müşteri tarafından kabul edildi.` };
    case 'quote.team_rejected':
      return en ? { title: 'Quote declined', body: `Quote ${v.number} was declined by the customer.` } : { title: 'Teklif reddedildi', body: `${v.number} numaralı teklif müşteri tarafından reddedildi.` };
    case 'todo.reminder':
      return en ? { title: 'Reminder', body: v.todo ?? 'You have a task due.' } : { title: 'Hatırlatma', body: v.todo ?? 'Zamanı gelen bir göreviniz var.' };
    case 'billing.usage_warning':
      return en
        ? { title: 'Approaching a monthly limit', body: `You have used ${v.used} of ${v.limit} ${f.en}s this month.` }
        : { title: 'Aylık limite yaklaşıldı', body: `Bu ay ${v.limit} ${f.tr} limitinizin ${v.used} kadarını kullandınız.` };
    case 'billing.limit_full':
      return en
        ? { title: 'Monthly limit full', body: `Your monthly ${f.en} limit is full (${v.used}/${v.limit}).` }
        : { title: 'Aylık limit doldu', body: `Aylık ${f.tr} limitiniz doldu (${v.used}/${v.limit}).` };
    case 'billing.limit_reached':
      return en
        ? { title: 'Monthly limit reached', body: `A new ${f.en} could not be added: the monthly limit is reached. Details were sent to your e-mail.` }
        : { title: 'Aylık limite ulaşıldı', body: `Aylık ${f.tr} limitine ulaşıldığı için yeni kayıt eklenemedi. Ayrıntıları e-posta adresinize gönderdik.` };
    case 'billing.subscription_ending':
      return en ? { title: 'Plan period ending', body: `Your plan period ends in ${v.days} days.` } : { title: 'Plan dönemi bitiyor', body: `Plan döneminiz ${v.days} gün içinde sona eriyor.` };
    default:
      return en ? { title: 'Welcome to Otopoly', body: 'Notifications about your business will appear here.' } : { title: "Otopoly'ye hoş geldiniz", body: 'İşletmenizle ilgili bildirimler burada görünecek.' };
  }
}

// ─── Rows ──────────────────────────────────────────────────────────────────

function orgSlugFor(user: MockUser) {
  const db = getDb();
  const m = db.memberships.find((x) => x.userUuid === user.uuid);
  return db.organizations.find((o) => o.uuid === m?.orgUuid)?.slug ?? null;
}

function actionUrlFor(kind: string, slug: string | null, ref?: string) {
  if (!slug) return undefined;
  if (kind.startsWith('quote.') && ref) return `/t/${slug}/quotes/${ref}`;
  if (kind === 'todo.reminder' && ref) return `/t/${slug}/todos?todo=${ref}`;
  if (kind.startsWith('billing.')) return `/t/${slug}/settings/billing`;
  return undefined;
}

function makeNotification(user: MockUser, kind: string, createdAt: Date, opts: { read?: boolean; ref?: string; vars?: Vars } = {}): MockNotification {
  const id = uuid();
  const slug = orgSlugFor(user);
  const action = actionUrlFor(kind, slug, opts.ref);
  const created = createdAt.toISOString();
  const exp = Math.floor(Date.now() / 1000) + SIGNED_TTL_S;
  const copy = copyFor(kind, user.locale, opts.vars ?? {});
  return {
    _user: user.uuid,
    uuid: id,
    channel: 'inapp',
    status: opts.read ? 'read' : 'delivered',
    priority: kind === 'billing.limit_reached' || kind === 'billing.limit_full' ? 'high' : 'normal',
    title: copy.title,
    body: copy.body,
    payload: { kind, ...(slug ? { organization_slug: slug } : {}) },
    ...(action ? { action_url: action, signed_action_url: `/v1/notifications/${id}/action?exp=${exp}&sig=${encodeURIComponent(signFor(id, exp))}` } : {}),
    recipient: user.email,
    template_code: kind,
    source_event: kind,
    sent_at: created,
    ...(opts.read ? { read_at: created } : {}),
    created_at: created,
    updated_at: created,
    user: { uuid: user.uuid, name: user.name, surname: user.surname, email: user.email },
  };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

function isOwner(user: MockUser) {
  return getDb().memberships.some((m) => m.userUuid === user.uuid && m.role === 'owner');
}

function seedFor(user: MockUser): MockNotification[] {
  const db = getDb();
  const quotes = db.quotes.slice(0, 12);
  const todos = db.todos.filter((t) => t.status === 'open').slice(0, 6);
  const q = (i: number) => quotes[i % Math.max(quotes.length, 1)];
  const t = (i: number) => todos[i % Math.max(todos.length, 1)];
  const quoteVars = (i: number) => ({ number: q(i)?.number ?? `TKL-${1000 + i}` });
  const out: MockNotification[] = [];
  const add = (kind: string, minutes: number, read: boolean, ref?: string, vars?: Vars) => out.push(makeNotification(user, kind, minutesAgo(minutes), { read, ref, vars }));

  // Fresh, unread: one of every kind the user can get.
  add('quote.team_accepted', 6, false, q(0)?.uuid, quoteVars(0));
  add('todo.reminder', 25, false, t(0)?.uuid, { todo: t(0)?.title });
  if (isOwner(user)) {
    add('billing.limit_reached', 50, false, undefined, { feature: 'customers', used: 2500, limit: 2500 });
    add('billing.usage_warning', 3 * 60, false, undefined, { feature: 'jobs', used: 240, limit: 300 });
  }
  add('quote.team_created', 5 * 60, false, q(1)?.uuid, quoteVars(1));
  add('quote.team_expiring', 9 * 60, true, q(2)?.uuid, quoteVars(2));
  add('quote.team_rejected', 26 * 60, true, q(3)?.uuid, quoteVars(3));
  if (isOwner(user)) {
    add('billing.limit_full', 30 * 60, true, undefined, { feature: 'whatsapp', used: 500, limit: 500 });
    add('billing.subscription_ending', 2 * 1440, true, undefined, { days: 7 });
  }
  // Older history (read) so the inbox paginates.
  for (let i = 0; i < 18; i++) {
    const kind = i % 3 === 0 ? 'todo.reminder' : i % 3 === 1 ? 'quote.team_created' : 'quote.team_accepted';
    const ref = kind === 'todo.reminder' ? t(i + 1)?.uuid : q(i + 4)?.uuid;
    add(kind, (3 + i) * 1440, true, ref, kind === 'todo.reminder' ? { todo: t(i + 1)?.title } : quoteVars(i + 4));
  }
  add('system.welcome', 30 * 1440, true);
  return out;
}

/** The user's inbox (seeded on first access). */
function inboxOf(user: MockUser) {
  const db = ext();
  db._notifications ??= [];
  db._notificationsSeeded ??= [];
  if (!db._notificationsSeeded.includes(user.uuid)) {
    db._notificationsSeeded.push(user.uuid);
    db._notifications.push(...seedFor(user));
  }
  return db._notifications.filter((n) => n._user === user.uuid);
}

const isUnread = (n: MockNotification) => n.channel === 'inapp' && !n.read_at && n.status !== 'read';
const strip = ({ _user, ...n }: MockNotification) => n;

function findOwn(ctx: MockCtx) {
  const user = userOf(ctx);
  const n = inboxOf(user).find((x) => x.uuid === ctx.params.uuid);
  if (!n) fail(404, 'NOT_FOUND', 'Notification not found');
  return n!;
}

function markRead(n: MockNotification) {
  if (n.read_at) return;
  const ts = now();
  n.read_at = ts;
  n.status = 'read';
  n.updated_at = ts;
}

// ─── Inbox routes (static before /:uuid) ───────────────────────────────────

route('GET', '/v1/notifications', (ctx) => {
  const user = userOf(ctx);
  let items = inboxOf(user);
  if (ctx.query.channel) items = items.filter((n) => n.channel === ctx.query.channel);
  if (ctx.query.status) items = items.filter((n) => n.status === ctx.query.status);
  if (ctx.query.unread === 'true') items = items.filter(isUnread);
  items = search(items, ctx.query.q, ['title', 'body']);
  const page = paginate(sortBy(items, ctx.query.sort, '-created_at'), ctx.query);
  return { ...page, items: page.items.map(strip) };
});

route('GET', '/v1/notifications/meta', () => ({ resource: 'notifications', default_sort: '-created_at', capabilities: { search: true, filters: ['status', 'channel', 'unread'] } }));

route('GET', '/v1/notifications/unread-count', (ctx) => ({ count: inboxOf(userOf(ctx)).filter(isUnread).length }));

route('POST', '/v1/notifications/read-all', (ctx) => {
  inboxOf(userOf(ctx)).filter(isUnread).forEach(markRead);
  return { status: 'ok' };
});

let testSeq = 0;
/** Enqueues a "test" notification to self. The mock picks a real kind so the deep link can be tried. */
route('POST', '/v1/notifications/test', (ctx) => {
  const user = userOf(ctx);
  inboxOf(user);
  const db = getDb();
  const owner = isOwner(user);
  const kinds = owner ? (['quote.team_accepted', 'todo.reminder', 'billing.usage_warning'] as const) : (['quote.team_accepted', 'todo.reminder'] as const);
  const kind = kinds[testSeq++ % kinds.length];
  const quote = db.quotes[testSeq % Math.max(db.quotes.length, 1)];
  const todo = db.todos.find((t) => t.status === 'open');
  const n =
    kind === 'todo.reminder'
      ? makeNotification(user, kind, new Date(), { ref: todo?.uuid, vars: { todo: todo?.title } })
      : kind === 'billing.usage_warning'
        ? makeNotification(user, kind, new Date(), { vars: { feature: 'jobs', used: 250, limit: 300 } })
        : makeNotification(user, kind, new Date(), { ref: quote?.uuid, vars: { number: quote?.number } });
  ext()._notifications!.push(n);
  return { items: [strip(n)] };
});

route('GET', '/v1/notifications/:uuid', (ctx) => strip(findOwn(ctx)));

route('GET', '/v1/notifications/:uuid/action', (ctx) => {
  const n = findOwn(ctx);
  const exp = Number(ctx.query.exp);
  if (!Number.isFinite(exp) || !ctx.query.sig || ctx.query.sig !== signFor(n.uuid, exp)) fail(400, 'INVALID_SIGNATURE', 'Invalid action signature');
  if (exp * 1000 < Date.now()) fail(400, 'ACTION_EXPIRED', 'Action link expired');
  markRead(n);
  return { destination: n.action_url ?? '', notification: strip(n) };
});

route('POST', '/v1/notifications/:uuid/read', (ctx) => {
  const n = findOwn(ctx);
  markRead(n);
  return strip(n);
});

// ─── Push devices ──────────────────────────────────────────────────────────

const TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;

route('POST', '/v1/push-devices', (ctx) => {
  const user = userOf(ctx);
  const b = ctx.body;
  const token = str(b.token).trim();
  const errors: { field: string; message: string }[] = [];
  if (!TOKEN_RE.test(token)) errors.push({ field: 'token', message: 'must be an Expo push token' });
  if (b.platform !== 'ios' && b.platform !== 'android') errors.push({ field: 'platform', message: 'must be ios or android' });
  if (str(b.app_version).length > 32) errors.push({ field: 'app_version', message: 'must be at most 32 characters' });
  if (str(b.device_name).length > 120) errors.push({ field: 'device_name', message: 'must be at most 120 characters' });
  if (errors.length) validation(errors);

  const db = ext();
  db._pushDevices ??= [];
  const rawLocale = str(b.locale).toLowerCase().slice(0, 2);
  const locale = (rawLocale === 'tr' || rawLocale === 'en' ? rawLocale : '') as PushDevice['locale'];
  const ts = now();
  let device = db._pushDevices.find((d) => d.token === token);
  if (device) {
    // Unique token: a token registered by another account on this phone moves to the caller.
    Object.assign(device, { _user: user.uuid, _disabled: false, platform: b.platform, locale, app_version: str(b.app_version), device_name: str(b.device_name), last_seen_at: ts });
  } else {
    device = { _user: user.uuid, uuid: uuid(), token, platform: b.platform as PushDevice['platform'], locale, app_version: str(b.app_version), device_name: str(b.device_name), last_seen_at: ts, created_at: ts };
    db._pushDevices.push(device);
  }
  // First registration creates the preference row with push on; an existing one is left untouched.
  const prefs = db._notificationPrefs?.[user.uuid];
  let pushEnabled = prefs?.push_enabled ?? true;
  if (!prefs) {
    db._notificationPrefs = { ...db._notificationPrefs, [user.uuid]: { email_enabled: true, inapp_enabled: true, realtime_enabled: true, push_enabled: true } };
    pushEnabled = true;
  }
  const { _user, _disabled, ...publicDevice } = device;
  return { device: publicDevice, push_enabled: pushEnabled };
});

route('DELETE', '/v1/push-devices/:token', (ctx) => {
  const user = userOf(ctx);
  const db = ext();
  // Idempotent: unknown tokens or another user's token change nothing.
  db._pushDevices = (db._pushDevices ?? []).filter((d) => !(d.token === ctx.params.token && d._user === user.uuid));
  return { status: 'ok' };
});

/** Test helper: the caller's registered devices. */
export function pushDevicesOf(userUuid: string) {
  return (ext()._pushDevices ?? []).filter((d) => d._user === userUuid);
}
