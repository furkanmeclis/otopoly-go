/**
 * Settings area: WhatsApp messaging (session, rules, template catalog, simulation),
 * daily summary, vehicle alerts and export settings / letterhead.
 * State lives in this module (per organization), created lazily from the shared demo DB.
 */
import type { AppSettings } from '@/features/io/types';
import type { DailySummaryMember, DailySummarySettings } from '@/features/messaging/services/daily-summary.service';
import type { MessageTemplateEntry, MessageTemplateType } from '@/features/messaging/services/templates.service';
import type { VehicleAlertEvent, VehicleAlertMember, VehicleAlertSettings } from '@/features/messaging/services/vehicle-alerts.service';
import type { NotificationRule, RuleList, SimulateResultItem, WhatsAppSession } from '@/features/messaging/types';

import { bool, fail, istanbulDay, money, now, num, requireOwner, requirePerm, route, str, uuid, validation, type MockCtx } from '../core';
import { getDb } from '../db';

// ─── WhatsApp session ────────────────────────────────────────────────────────

/** Seconds a pairing QR stays valid (same as the web countdown). */
const QR_TTL = 60;
/** Demo: the QR is "scanned" automatically this long after it is shown. */
const AUTO_PAIR_MS = 9000;

type SessionState = WhatsAppSession & { _pairAt?: number };
const sessions = new Map<string, SessionState>();

function sessionFor(ctx: MockCtx): SessionState {
  const key = ctx.orgUuid ?? '-';
  let s = sessions.get(key);
  if (!s) {
    s = { uuid: uuid(), status: 'disconnected', created_at: now(), updated_at: now() };
    sessions.set(key, s);
  }
  // Demo pairing: the phone "scans" the QR a few seconds after it is shown.
  if (s.status === 'qr_pending' && s._pairAt && Date.now() >= s._pairAt) {
    const org = getDb().organizations.find((o) => o.uuid === ctx.orgUuid);
    Object.assign(s, {
      status: 'connected',
      jid: '905321234567@s.whatsapp.net',
      phone_number: '905321234567',
      display_name: org?.name ?? 'Otopoly',
      qr_code: undefined,
      qr_expires_at: undefined,
      last_seen_at: now(),
      updated_at: now(),
      _pairAt: undefined,
    });
  }
  return s;
}

const publicSession = ({ _pairAt: _p, ...s }: SessionState): WhatsAppSession => s;

/** WhatsApp-like pairing payload ("ref,noiseKey,identityKey,advSecret"). */
function pairingCode() {
  const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const rnd = (n: number) => Array.from({ length: n }, () => b64[Math.floor(Math.random() * 64)]).join('');
  return `2@${rnd(88)},${rnd(43)}=,${rnd(43)}=,${rnd(43)}=`;
}

route('GET', '/v1/tenant/messaging/session', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.read');
  return publicSession(sessionFor(ctx));
});

route('POST', '/v1/tenant/messaging/session/connect', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const s = sessionFor(ctx);
  if (s.status === 'connected') return publicSession(s);
  Object.assign(s, {
    status: 'qr_pending',
    qr_code: pairingCode(),
    qr_expires_at: new Date(Date.now() + QR_TTL * 1000).toISOString(),
    error_message: undefined,
    updated_at: now(),
    _pairAt: Date.now() + AUTO_PAIR_MS,
  });
  return publicSession(s);
});

route('DELETE', '/v1/tenant/messaging/session', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const s = sessionFor(ctx);
  Object.assign(s, {
    status: 'disconnected',
    jid: undefined,
    phone_number: undefined,
    display_name: undefined,
    qr_code: undefined,
    qr_expires_at: undefined,
    updated_at: now(),
    _pairAt: undefined,
  });
  return { disconnected: true };
});

// ─── Template catalog (mirrors backend msgtemplate registry) ─────────────────

type Ph = { key: string; sample_tr: string; sample_en: string };
const ph = (key: string, sample_tr: string, sample_en = sample_tr): Ph => ({ key, sample_tr, sample_en });
const P = {
  customer: ph('customer_name', 'Ahmet Yılmaz', 'John Smith'),
  company: ph('company_name', 'Tech Oto'),
  business: ph('business_name', 'Tech Oto'),
  plate: ph('plate', '34 ABC 123'),
  job: ph('job_id', 'JOB-DEMO-001'),
  amount: ph('amount', '1.250,00', '1,250.00'),
  currency: ph('currency', 'TRY'),
  contract: ph('contract_title', 'Hizmet Sözleşmesi', 'Service Agreement'),
  quoteNo: ph('quote_number', 'TKL-000042', 'QUO-000042'),
  quoteTotal: ph('total_amount', '12.500,00 TRY', 'TRY 12,500.00'),
  validUntil: ph('valid_until', '30.09.2026', 'Sep 30, 2026'),
  quoteLink: ph('quote_link', 'https://otopoly.app/q/abc123'),
  createdBy: ph('created_by_name', 'Mehmet Kaya', 'Mark Brown'),
  appLink: ph('app_link', 'https://otopoly.app/t/tech-oto/quotes/abc'),
  todoTitle: ph('todo_title', '34 ABC 123 seramik kontrolü', 'Ceramic coating check 34 ABC 123'),
  dueAt: ph('due_at', '25.09.2026 14:30', 'Sep 25, 2026 14:30'),
  dueIn: ph('due_in', '15 dakika sonra', 'in 15 minutes'),
  assignee: ph('assignee_name', 'Ayşe Demir', 'Jane Doe'),
  notes: ph('todo_notes', 'Müşteriyi arayın.', 'Call the customer.'),
  todoLink: ph('todo_link', 'https://otopoly.app/t/tech-oto/todos'),
};

type Spec = { type: string; group: string; audience: 'customer' | 'staff'; channels: MessageTemplateEntry['channel'][]; placeholders: Ph[]; label: [string, string] };
const CUSTOMER: Spec['channels'] = ['whatsapp', 'sms'];
const jobPh = [P.customer, P.company, P.business, P.job, P.plate];
const quotePh = [P.customer, P.company, P.quoteNo, P.quoteTotal, P.validUntil, P.quoteLink, P.plate];
const teamQuotePh = [P.quoteNo, P.customer, P.quoteTotal, P.validUntil, P.createdBy, P.assignee, P.company, P.appLink];

const SPECS: Spec[] = [
  { type: 'job.created', group: 'jobs', audience: 'customer', channels: CUSTOMER, placeholders: jobPh, label: ['İş Oluşturuldu', 'Job created'] },
  { type: 'job.ready', group: 'jobs', audience: 'customer', channels: CUSTOMER, placeholders: jobPh, label: ['Araç Teslime Hazır', 'Vehicle ready'] },
  { type: 'job.delivered', group: 'jobs', audience: 'customer', channels: CUSTOMER, placeholders: jobPh, label: ['Araç Teslim Edildi', 'Vehicle delivered'] },
  { type: 'job.cancelled', group: 'jobs', audience: 'customer', channels: CUSTOMER, placeholders: jobPh, label: ['İş İptal Edildi', 'Job cancelled'] },
  { type: 'job.paid', group: 'jobs', audience: 'customer', channels: CUSTOMER, placeholders: [P.customer, P.company, P.business, P.job, P.amount, P.currency, P.plate], label: ['Ödeme Alındı', 'Payment received'] },
  { type: 'contract.signed', group: 'contracts', audience: 'customer', channels: CUSTOMER, placeholders: [P.customer, P.company, P.business, P.contract, P.plate, P.job], label: ['Sözleşme İmzalandı', 'Contract signed'] },
  { type: 'sale.created', group: 'sales', audience: 'customer', channels: CUSTOMER, placeholders: [P.customer, P.company, P.business, P.amount, P.currency, P.plate], label: ['Satış Oluşturuldu', 'Sale created'] },
  ...(['quote.created', 'quote.sent', 'quote.reminder', 'quote.expiring'] as const).map<Spec>((type, i) => ({
    type,
    group: 'quotes',
    audience: 'customer',
    channels: ['whatsapp', 'sms', 'email'],
    placeholders: quotePh,
    label: [['Teklif Oluşturuldu', 'Teklif Gönderildi', 'Teklif Hatırlatması', 'Teklif Süresi Doluyor'][i], ['Quote created', 'Quote sent', 'Quote reminder', 'Quote expiring'][i]],
  })),
  ...(['quote.team_created', 'quote.team_expiring', 'quote.team_accepted', 'quote.team_rejected'] as const).map<Spec>((type, i) => ({
    type,
    group: 'quotes',
    audience: 'staff',
    channels: ['inapp', 'email'],
    placeholders: teamQuotePh,
    label: [['Yeni teklif', 'Teklif süresi doluyor', 'Teklif kabul edildi', 'Teklif reddedildi'][i], ['New quote', 'Quote expiring', 'Quote accepted', 'Quote rejected'][i]],
  })),
  {
    type: 'todo.reminder',
    group: 'todos',
    audience: 'staff',
    channels: ['inapp', 'email', 'whatsapp', 'sms'],
    placeholders: [P.todoTitle, P.dueAt, P.dueIn, P.assignee, P.notes, P.customer, P.company, P.todoLink],
    label: ['Görev hatırlatması', 'Task reminder'],
  },
];

/** Customer-facing WhatsApp defaults from migration 000052; other channels get a short generic text. */
const DEFAULT_BODIES: Record<string, [string, string]> = {
  'job.created': [
    'Sayın {{customer_name}},\n\nAracınız ({{plate}}) servisimize alındı. İş No: {{job_id}}\n\nGelişmeleri size bildireceğiz.\n{{company_name}}',
    'Dear {{customer_name}},\n\nYour vehicle ({{plate}}) has been checked in. Job no: {{job_id}}\n\nWe will keep you posted.\n{{company_name}}',
  ],
  'job.ready': [
    'Sayın {{customer_name}},\n\nAracınızın işlemi tamamlandı, teslime hazır.\nİş No: {{job_id}} | Plaka: {{plate}}\n\nİyi günler dileriz.\n{{company_name}}',
    'Dear {{customer_name}},\n\nYour vehicle is ready for pickup.\nJob no: {{job_id}} | Plate: {{plate}}\n\nHave a nice day.\n{{company_name}}',
  ],
  'job.delivered': [
    'Sayın {{customer_name}},\n\nAracınız ({{plate}}) teslim edildi. İş No: {{job_id}}\n\nBizi tercih ettiğiniz için teşekkürler.\n{{company_name}}',
    'Dear {{customer_name}},\n\nYour vehicle ({{plate}}) has been delivered. Job no: {{job_id}}\n\nThank you for choosing us.\n{{company_name}}',
  ],
  'job.paid': [
    'Sayın {{customer_name}},\n\nÖdemeniz başarıyla alındı. Tutar: {{amount}} {{currency}}\nPlaka: {{plate}}\n\nTeşekkür ederiz.\n{{company_name}}',
    'Dear {{customer_name}},\n\nWe received your payment. Amount: {{amount}} {{currency}}\nPlate: {{plate}}\n\nThank you.\n{{company_name}}',
  ],
  'job.cancelled': [
    'Sayın {{customer_name}},\n\n{{plate}} plakalı aracınız için işlem iptal edildi. İş No: {{job_id}}\n\nSorularınız için bize ulaşabilirsiniz.\n{{company_name}}',
    'Dear {{customer_name}},\n\nThe job for your vehicle {{plate}} was cancelled. Job no: {{job_id}}\n\nContact us with any questions.\n{{company_name}}',
  ],
  'contract.signed': [
    'Sayın {{customer_name}},\n\n"{{contract_title}}" sözleşmeniz başarıyla imzalandı.\nPlaka: {{plate}}\n\nİyi günler dileriz.\n{{company_name}}',
    'Dear {{customer_name}},\n\nYour contract "{{contract_title}}" has been signed.\nPlate: {{plate}}\n\nHave a nice day.\n{{company_name}}',
  ],
  'sale.created': [
    'Sayın {{customer_name}},\n\nSatışınız oluşturuldu. Tutar: {{amount}} {{currency}}\n\nTeşekkür ederiz.\n{{company_name}}',
    'Dear {{customer_name}},\n\nYour purchase was recorded. Amount: {{amount}} {{currency}}\n\nThank you.\n{{company_name}}',
  ],
  'quote.created': [
    'Sayın {{customer_name}},\n\n{{quote_number}} numaralı teklifiniz hazırlandı.\nTutar: {{total_amount}}\nGeçerlilik: {{valid_until}}\n\n{{company_name}}',
    'Dear {{customer_name}},\n\nYour quote {{quote_number}} has been prepared.\nTotal: {{total_amount}}\nValid until: {{valid_until}}\n\n{{company_name}}',
  ],
  'quote.sent': [
    'Sayın {{customer_name}},\n\n{{quote_number}} numaralı teklifimizi bağlantıda bulabilirsiniz: {{quote_link}}\nTutar: {{total_amount}}\nGeçerlilik: {{valid_until}}\n\n{{company_name}}',
    'Dear {{customer_name}},\n\nPlease find our quote {{quote_number}} at: {{quote_link}}\nTotal: {{total_amount}}\nValid until: {{valid_until}}\n\n{{company_name}}',
  ],
  'todo.reminder': ['Hatırlatma: {{todo_title}} ({{due_in}})\n{{todo_link}}', 'Reminder: {{todo_title}} ({{due_in}})\n{{todo_link}}'],
};

function defaultEntry(spec: Spec, channel: MessageTemplateEntry['channel'], locale: 'tr' | 'en') {
  const li = locale === 'tr' ? 0 : 1;
  const subject = spec.label[li];
  const known = DEFAULT_BODIES[spec.type]?.[li];
  const keys = spec.placeholders.map((p) => p.key);
  const body =
    known && (channel === 'whatsapp' || channel === 'sms' || channel === 'email')
      ? known
      : `${subject}: ${keys.slice(0, 3).map((k) => `{{${k}}}`).join(' · ')}`;
  return { subject, body };
}

type Override = { uuid: string; subject: string; body: string; is_active: boolean };
const overrides = new Map<string, Override>(); // `${org}|${type}|${channel}|${locale}`
const okey = (ctx: MockCtx, type: string, channel: string, locale: string) => `${ctx.orgUuid}|${type}|${channel}|${locale}`;

function catalogFor(ctx: MockCtx): MessageTemplateType[] {
  return SPECS.map((spec) => ({
    type: spec.type,
    group: spec.group,
    audience: spec.audience,
    channels: spec.channels,
    placeholders: spec.placeholders,
    templates: spec.channels.flatMap((channel) =>
      (['tr', 'en'] as const).map<MessageTemplateEntry>((locale) => {
        const def = defaultEntry(spec, channel, locale);
        const o = overrides.get(okey(ctx, spec.type, channel, locale));
        return {
          channel,
          locale,
          subject: o?.subject ?? def.subject,
          body: o?.body ?? def.body,
          is_active: o?.is_active ?? true,
          is_custom: Boolean(o),
          ...(o ? { uuid: o.uuid } : {}),
          default_subject: def.subject,
          default_body: def.body,
        };
      }),
    ),
  }));
}

const PLACEHOLDER_RE = /\{\{\s*\.?([a-zA-Z0-9_]+)\s*\}\}/g;
const render = (tpl: string, vars: Record<string, string>) => tpl.replace(PLACEHOLDER_RE, (_m, k: string) => vars[k.toLowerCase()] ?? '');

function templateKey(ctx: MockCtx) {
  const spec = SPECS.find((s) => s.type === ctx.params.event_type);
  if (!spec) fail(404, 'NOT_FOUND', 'Template type not found');
  const channel = ctx.params.channel as MessageTemplateEntry['channel'];
  const locale = ctx.params.locale;
  if (!spec!.channels.includes(channel)) validation([{ field: 'channel', message: 'unsupported channel for this type' }]);
  if (locale !== 'tr' && locale !== 'en') validation([{ field: 'locale', message: 'unsupported locale' }]);
  return { spec: spec!, channel, locale: locale as 'tr' | 'en' };
}

function entryOf(ctx: MockCtx, type: string, channel: string, locale: string) {
  return catalogFor(ctx)
    .find((t) => t.type === type)!
    .templates.find((e) => e.channel === channel && e.locale === locale)!;
}

route('GET', '/v1/tenant/messaging/template-types', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.read');
  return catalogFor(ctx);
});

route('PUT', '/v1/tenant/messaging/template-types/:event_type/:channel/:locale', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const { spec, channel, locale } = templateKey(ctx);
  const subject = str(ctx.body.subject).trim();
  const body = str(ctx.body.body);
  const errs: { field: string; message: string; code?: string }[] = [];
  if (!body.trim()) errs.push({ field: 'body', message: 'required', code: 'required' });
  if (body.length > 4000) errs.push({ field: 'body', message: 'too long', code: 'max_length' });
  if (subject.length > 200) errs.push({ field: 'subject', message: 'too long', code: 'max_length' });
  const allowed = new Set(spec.placeholders.map((p) => p.key));
  const unknown = [...`${subject}\n${body}`.matchAll(PLACEHOLDER_RE)].map((m) => m[1].toLowerCase()).filter((k) => !allowed.has(k));
  if (unknown.length) errs.push({ field: 'body', message: `unknown placeholders: ${[...new Set(unknown)].join(', ')}`, code: 'unknown_placeholder' });
  if (errs.length) validation(errs);
  const key = okey(ctx, spec.type, channel, locale);
  overrides.set(key, { uuid: overrides.get(key)?.uuid ?? uuid(), subject, body, is_active: bool(ctx.body.is_active, true) });
  return entryOf(ctx, spec.type, channel, locale);
});

route('DELETE', '/v1/tenant/messaging/template-types/:event_type/:channel/:locale', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const { spec, channel, locale } = templateKey(ctx);
  overrides.delete(okey(ctx, spec.type, channel, locale));
  return entryOf(ctx, spec.type, channel, locale);
});

// ─── Notification rules ─────────────────────────────────────────────────────

const RULE_TYPES = ['job.created', 'contract.signed', 'job.ready', 'job.delivered', 'job.paid', 'job.cancelled', 'sale.created', 'quote.created', 'quote.sent', 'quote.reminder', 'quote.expiring'];
const ruleState = new Map<string, NotificationRule>(); // `${org}|${type}|${channel}`

function rule(ctx: MockCtx, type: string, channel: string): NotificationRule {
  const key = `${ctx.orgUuid}|${type}|${channel}`;
  let r = ruleState.get(key);
  if (!r) {
    r = { uuid: uuid(), event_type: type, channel, enabled: channel === 'whatsapp' && ['job.ready', 'job.delivered', 'job.paid'].includes(type) };
    ruleState.set(key, r);
  }
  return r;
}

route('GET', '/v1/tenant/messaging/rules', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.read');
  return RULE_TYPES.map<RuleList>((type) => ({
    event_type: type,
    event_label: SPECS.find((s) => s.type === type)!.label[0],
    rules: [rule(ctx, type, 'whatsapp'), rule(ctx, type, 'sms')],
  }));
});

route('PATCH', '/v1/tenant/messaging/rules/:event_type/:channel', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const { event_type: type, channel } = ctx.params;
  if (!RULE_TYPES.includes(type)) fail(404, 'NOT_FOUND', 'Event type not found');
  if (channel !== 'whatsapp') validation([{ field: 'channel', message: 'channel not available yet', code: 'unsupported' }]);
  if (typeof ctx.body.enabled !== 'boolean') validation([{ field: 'enabled', message: 'required', code: 'required' }]);
  const r = rule(ctx, type, channel);
  r.enabled = ctx.body.enabled as boolean;
  return r;
});

// ─── Simulation (test sends) ────────────────────────────────────────────────

const LIFECYCLE = ['job.created', 'job.ready', 'job.delivered', 'job.paid'];

route('POST', '/v1/tenant/messaging/simulate', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const phone = str(ctx.body.phone).replace(/\s+/g, '');
  if (!phone) validation([{ field: 'phone', message: 'required', code: 'required' }]);
  if (!/^\+?\d{10,13}$/.test(phone)) validation([{ field: 'phone', message: 'invalid phone', code: 'invalid' }]);
  const mode = str(ctx.body.mode, 'event');
  const types = mode === 'job_lifecycle' ? LIFECYCLE : [str(ctx.body.event_type)];
  const vars = (ctx.body.vars ?? {}) as Record<string, string>;
  const connected = sessionFor(ctx).status === 'connected';
  const items = types.map<SimulateResultItem>((type) => {
    const entry = entryOf(ctx, type, 'whatsapp', 'tr');
    if (!entry) return { event_type: type, channel: 'whatsapp', status: 'failed', error_message: 'unknown event type' };
    const body = render(entry.body, vars);
    if (!connected) return { event_type: type, channel: 'whatsapp', status: 'failed', body, error_message: 'WhatsApp session is not connected' };
    if (!entry.is_active) return { event_type: type, channel: 'whatsapp', status: 'skipped', body, error_message: 'template is passive' };
    return { event_type: type, channel: 'whatsapp', status: 'sent', body, provider_reference: `wamid.${uuid().slice(0, 12)}` };
  });
  return { items };
});

// ─── Team members (daily summary / vehicle alerts recipients) ───────────────

function orgMembers(ctx: MockCtx) {
  const db = getDb();
  return db.memberships
    .filter((m) => m.orgUuid === ctx.orgUuid)
    .map((m, i) => {
      const u = db.users.find((x) => x.uuid === m.userUuid);
      return {
        uuid: m.userUuid,
        name: u ? `${u.name} ${u.surname}`.trim() : '',
        email: u?.email ?? '',
        role: m.role,
        // Deterministic demo channels: the owner has both, staff alternate.
        has_phone: m.role === 'owner' || i % 3 !== 2,
        has_push: m.role === 'owner' || i % 2 === 0,
      };
    });
}

// ─── Daily summary (owner-only) ─────────────────────────────────────────────

type DailyState = { enabled: boolean; send_time: string; recipient_user_uuids: string[]; last_sent_on: string | null };
const daily = new Map<string, DailyState>();

function dailyFor(ctx: MockCtx) {
  let s = daily.get(ctx.orgUuid!);
  if (!s) {
    const owner = orgMembers(ctx).find((m) => m.role === 'owner');
    const yesterday = istanbulDay(new Date(Date.now() - 86400000));
    s = { enabled: true, send_time: '20:00', recipient_user_uuids: owner ? [owner.uuid] : [], last_sent_on: yesterday };
    daily.set(ctx.orgUuid!, s);
  }
  return s;
}

function dailyView(ctx: MockCtx): DailySummarySettings {
  const s = dailyFor(ctx);
  return {
    ...s,
    whatsapp_connected: sessionFor(ctx).status === 'connected',
    members: orgMembers(ctx).map<DailySummaryMember>(({ has_push: _h, ...m }) => m),
  };
}

function validateRecipients(ctx: MockCtx, ids: unknown, errs: { field: string; message: string; code?: string }[]) {
  if (!Array.isArray(ids)) {
    errs.push({ field: 'recipient_user_uuids', message: 'required', code: 'required' });
    return [];
  }
  const members = new Set(orgMembers(ctx).map((m) => m.uuid));
  if (ids.some((id) => !members.has(String(id)))) errs.push({ field: 'recipient_user_uuids', message: 'not a member', code: 'invalid' });
  return [...new Set(ids.map(String))];
}

route('GET', '/v1/tenant/daily-summary/preview', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.read');
  const db = getDb();
  const today = istanbulDay();
  const jobs = db.jobs.filter((j) => j._org === ctx.orgUuid && istanbulDay(j.started_at) === today && j.status !== 'voided' && j.status !== 'cancelled');
  const revenue = jobs.reduce((sum, j) => sum + num(j.total_amount), 0);
  const unpaid = jobs.filter((j) => j.payment_status !== 'paid').reduce((sum, j) => sum + num(j.total_amount), 0);
  const perService = new Map<string, number>();
  for (const j of jobs) for (const l of j.lines) perService.set(l.name, (perService.get(l.name) ?? 0) + 1);
  const tl = (n: number) => `${money(n).replace('.', ',')} TL`;
  const org = db.organizations.find((o) => o.uuid === ctx.orgUuid);
  const lines = [
    `*${org?.name ?? 'Otopoly'} — Gün Sonu Özeti*`,
    `_${today.split('-').reverse().join('.')}_`,
    '',
    `*Araç:* ${jobs.length}`,
    ...[...perService.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => `• ${name}: ${n}`),
    '',
    `*Ciro:* ${tl(revenue)}`,
    `*Tahsil edilmeyen:* ${tl(unpaid)}`,
    '',
    '*Kasalar*',
    ...db.financeAccounts.filter((a) => a.is_active).map((a) => `• ${a.name}: ${tl(num(a.current_balance))}`),
  ];
  return { message: lines.join('\n'), date: today };
});

route('GET', '/v1/tenant/daily-summary', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.read');
  return dailyView(ctx);
});

route('PUT', '/v1/tenant/daily-summary', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const errs: { field: string; message: string; code?: string }[] = [];
  const time = str(ctx.body.send_time);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errs.push({ field: 'send_time', message: 'expected HH:MM', code: 'invalid' });
  const recipients = validateRecipients(ctx, ctx.body.recipient_user_uuids, errs);
  const enabled = bool(ctx.body.enabled);
  if (enabled && recipients.length === 0) errs.push({ field: 'recipient_user_uuids', message: 'at least one recipient', code: 'required' });
  if (errs.length) validation(errs);
  Object.assign(dailyFor(ctx), { enabled, send_time: time, recipient_user_uuids: recipients });
  return dailyView(ctx);
});

route('POST', '/v1/tenant/daily-summary/test', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  if (sessionFor(ctx).status !== 'connected') fail(409, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp session is not connected');
  const s = dailyFor(ctx);
  const members = orgMembers(ctx).filter((m) => s.recipient_user_uuids.includes(m.uuid));
  if (!members.some((m) => m.has_phone)) fail(409, 'NO_RECIPIENT_PHONE', 'No selected recipient has a notification phone');
  return { sent: members.filter((m) => m.has_phone).length, skipped: members.filter((m) => !m.has_phone).map((m) => m.name || m.email) };
});

// ─── Vehicle alerts (owner-only) ────────────────────────────────────────────

const ALERT_EVENTS: VehicleAlertEvent[] = ['created', 'ready', 'delivered', 'cancelled'];
type AlertState = { enabled: boolean; events: VehicleAlertEvent[]; service_uuids: string[]; recipient_user_uuids: string[]; batch_minutes: number };
const alerts = new Map<string, AlertState>();

function alertsFor(ctx: MockCtx) {
  let s = alerts.get(ctx.orgUuid!);
  if (!s) {
    s = { enabled: false, events: ['created', 'ready'], service_uuids: [], recipient_user_uuids: orgMembers(ctx).map((m) => m.uuid), batch_minutes: 0 };
    alerts.set(ctx.orgUuid!, s);
  }
  return s;
}

function alertsView(ctx: MockCtx): VehicleAlertSettings {
  return {
    ...alertsFor(ctx),
    whatsapp_connected: sessionFor(ctx).status === 'connected',
    members: orgMembers(ctx) as VehicleAlertMember[],
    services: getDb()
      .services.filter((s) => s.is_active)
      .map((s) => ({ uuid: s.uuid, name: s.name })),
  };
}

route('GET', '/v1/tenant/vehicle-alerts', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.read');
  return alertsView(ctx);
});

route('PUT', '/v1/tenant/vehicle-alerts', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const errs: { field: string; message: string; code?: string }[] = [];
  const events = Array.isArray(ctx.body.events) ? [...new Set(ctx.body.events.map(String))] : [];
  if (events.some((e) => !ALERT_EVENTS.includes(e as VehicleAlertEvent))) errs.push({ field: 'events', message: 'unknown event', code: 'invalid' });
  const enabled = bool(ctx.body.enabled);
  if (enabled && events.length === 0) errs.push({ field: 'events', message: 'at least one event', code: 'required' });
  const batch = num(ctx.body.batch_minutes);
  if (![0, 30, 60].includes(batch)) errs.push({ field: 'batch_minutes', message: 'must be 0, 30 or 60', code: 'invalid' });
  const serviceIds = new Set(getDb().services.map((s) => s.uuid));
  const services = Array.isArray(ctx.body.service_uuids) ? [...new Set(ctx.body.service_uuids.map(String))] : [];
  if (services.some((id) => !serviceIds.has(id))) errs.push({ field: 'service_uuids', message: 'unknown service', code: 'invalid' });
  const recipients = validateRecipients(ctx, ctx.body.recipient_user_uuids, errs);
  if (enabled && recipients.length === 0) errs.push({ field: 'recipient_user_uuids', message: 'at least one recipient', code: 'required' });
  if (errs.length) validation(errs);
  Object.assign(alertsFor(ctx), { enabled, events: events as VehicleAlertEvent[], service_uuids: services, recipient_user_uuids: recipients, batch_minutes: batch });
  return alertsView(ctx);
});

route('POST', '/v1/tenant/vehicle-alerts/test', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const s = alertsFor(ctx);
  const members = orgMembers(ctx).filter((m) => s.recipient_user_uuids.includes(m.uuid));
  if (!members.length) fail(409, 'NO_RECIPIENTS', 'No recipients selected');
  const connected = sessionFor(ctx).status === 'connected';
  const viaWhatsApp = members.filter((m) => !m.has_push && m.has_phone);
  return {
    in_app: members.length,
    whatsapp: connected ? viaWhatsApp.length : 0,
    skipped: members.filter((m) => !m.has_push && (!m.has_phone || !connected)).map((m) => m.name || m.email),
  };
});

// ─── Export settings / letterhead (owner-only, like the backend) ────────────

const exportSettings = new Map<string, AppSettings>();

function settingsFor(ctx: MockCtx): AppSettings {
  let s = exportSettings.get(ctx.orgUuid!);
  if (!s) {
    const org = getDb().organizations.find((o) => o.uuid === ctx.orgUuid);
    s = {
      company_name: org?.name ?? '',
      tagline: '',
      primary_color: '#EA6E43',
      address: org?.address ?? '',
      city: org?.city ?? '',
      district: org?.district ?? '',
      phone: org?.phone ?? '',
      email: org?.email ?? '',
      website: '',
      footer_text: '',
      paper_size: 'A4',
      logo_url: org?.logo_url ?? null,
    };
    exportSettings.set(ctx.orgUuid!, s);
  }
  return s;
}

const PAPER_SIZES = ['A4', 'A3', 'Letter', 'Legal'];
const TEXT_FIELDS = ['company_name', 'tagline', 'address', 'city', 'district', 'phone', 'email', 'website', 'footer_text'] as const;

route('GET', '/v1/tenant/settings', (ctx) => {
  requireOwner(ctx, 'tenant.settings.read');
  return settingsFor(ctx);
});

route('PATCH', '/v1/tenant/settings', (ctx) => {
  requireOwner(ctx, 'tenant.settings.write');
  const b = ctx.body;
  const errs: { field: string; message: string; code?: string }[] = [];
  if (b.company_name !== undefined && !str(b.company_name).trim()) errs.push({ field: 'company_name', message: 'required', code: 'required' });
  if (b.primary_color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(str(b.primary_color))) errs.push({ field: 'primary_color', message: 'invalid color', code: 'invalid' });
  if (b.paper_size !== undefined && !PAPER_SIZES.includes(str(b.paper_size))) errs.push({ field: 'paper_size', message: 'invalid paper size', code: 'invalid' });
  if (b.email !== undefined && str(b.email).trim() && !/^\S+@\S+\.\S+$/.test(str(b.email).trim())) errs.push({ field: 'email', message: 'invalid email', code: 'invalid' });
  if (errs.length) validation(errs);
  const s = settingsFor(ctx);
  for (const f of TEXT_FIELDS) if (b[f] !== undefined) s[f] = str(b[f]).trim();
  if (b.primary_color !== undefined) s.primary_color = str(b.primary_color).toUpperCase();
  if (b.paper_size !== undefined) s.paper_size = str(b.paper_size);
  return s;
});

route('PUT', '/v1/tenant/settings/logo', (ctx) => {
  requireOwner(ctx, 'tenant.settings.write');
  const s = settingsFor(ctx);
  s.logo_url = `/v1/tenant/settings/logo/${uuid()}`;
  return s;
});

route('DELETE', '/v1/tenant/settings/logo', (ctx) => {
  requireOwner(ctx, 'tenant.settings.write');
  const s = settingsFor(ctx);
  s.logo_url = null;
  return s;
});
