/**
 * Per-organization SMS channels (`/v1/tenant/messaging/sms*`, backend `messaging/smschannel`): Netgsm and
 * Twilio accounts with credentials kept server-side (only masked hints go out), one active provider at a
 * time, connection check, test SMS and the segment estimate (same rules as `platform/sms.Estimate`).
 * Demo: Netgsm is connected and active, Twilio is not connected. Credentials that look wrong (a Netgsm
 * user code that is not numeric, the password "wrong", a Twilio SID not starting with AC) fail the check.
 */
import type { components } from '@/api/generated/api';

import { fail, now, notFound, requireFields, requireOwner, requirePerm, route, str, uuid, validation, type MockCtx } from '../core';

type Schemas = components['schemas'];
type Provider = 'netgsm' | 'twilio';
type Account = Schemas['SmsProviderAccount'];
type Segments = Schemas['SmsSegments'];

const PROVIDERS: Record<Provider, { fields: { key: string; secret: boolean; required: boolean }[]; sender_kind: 'msgheader' | 'from' }> = {
  netgsm: {
    fields: [
      { key: 'usercode', secret: false, required: true },
      { key: 'password', secret: true, required: true },
    ],
    sender_kind: 'msgheader',
  },
  twilio: {
    fields: [
      { key: 'account_sid', secret: false, required: true },
      { key: 'auth_token', secret: true, required: true },
    ],
    sender_kind: 'from',
  },
};

type Row = { account: Account; creds: Record<string, string> };
const orgs = new Map<string, Map<Provider, Row>>();

/** Same masking as `sms.Hint`. */
function hint(value: string, secret: boolean) {
  const r = [...value.trim()];
  if (!r.length) return '';
  if (secret) return r.length <= 6 ? '••••••' : `••••••${r.slice(-2).join('')}`;
  return r.length <= 6 ? `${r[0]}••••` : `${r.slice(0, 2).join('')}••••${r.slice(-2).join('')}`;
}
/** Same as `sms.MaskPhone`. */
const maskPhone = (phone: string) => (phone.length <= 7 ? '•'.repeat(phone.length) : `${phone.slice(0, -7)}•••${phone.slice(-4)}`);

function hints(provider: Provider, creds: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const f of PROVIDERS[provider].fields) if (creds[f.key]) out[f.key] = hint(creds[f.key], f.secret);
  return out;
}

function store(ctx: MockCtx) {
  const org = ctx.orgUuid!;
  let s = orgs.get(org);
  if (!s) {
    s = new Map();
    const at = new Date(Date.now() - 6 * 86400000).toISOString();
    const creds = { usercode: '8503071234', password: 'demo-api-sifre' };
    s.set('netgsm', {
      creds,
      account: {
        uuid: uuid(),
        provider: 'netgsm',
        sender: 'TECHOTO',
        is_active: true,
        status: 'connected',
        last_checked_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        credential_hints: hints('netgsm', creds),
        created_at: at,
        updated_at: at,
      },
    });
    orgs.set(org, s);
  }
  return s;
}

/** Active SMS provider of the organization ('' = none); used by daily summary, vehicle alerts and contract OTP. */
export function activeSmsProvider(ctx: MockCtx): Provider | '' {
  for (const [p, row] of store(ctx)) if (row.account.is_active) return p;
  return '';
}

function providerOf(ctx: MockCtx): Provider {
  const p = ctx.params.provider as Provider;
  if (!(p in PROVIDERS)) notFound('SMS provider');
  return p;
}

const GSM_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENDED = '^{}\\[~]|€\f';
const TURKISH_ONLY = 'çğĞıİşŞ';
const PART_SIZES: Record<Segments['encoding'], [number, number]> = { gsm7: [160, 153], turkish: [155, 150], ucs2: [70, 67] };

/** Same as `sms.Estimate`. */
export function estimateSegments(body: string, provider: Provider): Segments {
  let encoding: Segments['encoding'] = provider === 'netgsm' ? 'turkish' : 'gsm7';
  let chars = 0;
  for (const ch of body) {
    if (GSM_BASIC.includes(ch)) chars++;
    else if (GSM_EXTENDED.includes(ch)) chars += 2;
    else if (TURKISH_ONLY.includes(ch) && provider === 'netgsm') chars++;
    else encoding = 'ucs2';
  }
  if (encoding === 'ucs2') chars = body.length; // UTF-16 code units
  const [single, multi] = PART_SIZES[encoding];
  if (chars === 0) return { encoding, characters: 0, segments: 0, per_segment: single, remaining: single };
  if (chars <= single) return { encoding, characters: chars, segments: 1, per_segment: single, remaining: single - chars };
  const segments = Math.ceil(chars / multi);
  return { encoding, characters: chars, segments, per_segment: multi, remaining: segments * multi - chars };
}

function credentialsWork(provider: Provider, creds: Record<string, string>) {
  if (provider === 'netgsm') return /^\d{6,}$/.test(creds.usercode ?? '') && creds.password !== 'wrong';
  return /^AC[0-9a-zA-Z]{8,}$/.test(creds.account_sid ?? '') && creds.auth_token !== 'wrong';
}

/** Turkish numbers as 05… / 5…, others with a country code (+44…) → E.164 (or null). */
function toE164(raw: string) {
  const s = raw.replace(/[\s()-]/g, '');
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^0?5\d{9}$/.test(s)) return `+90${s.replace(/^0/, '')}`;
  if (/^90\d{10}$/.test(s)) return `+${s}`;
  return null;
}

function setActive(ctx: MockCtx, provider: Provider, active: boolean) {
  const s = store(ctx);
  if (active) for (const [p, row] of s) if (p !== provider && row.account.is_active) Object.assign(row.account, { is_active: false, updated_at: now() });
  const row = s.get(provider) ?? notFound('SMS provider account');
  Object.assign(row.account, { is_active: active, updated_at: now() });
  return row.account;
}

route('GET', '/v1/tenant/messaging/sms', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.read');
  const s = store(ctx);
  return {
    active_provider: activeSmsProvider(ctx),
    providers: (Object.keys(PROVIDERS) as Provider[]).map((provider) => ({ provider, ...PROVIDERS[provider], account: s.get(provider)?.account ?? null })),
  };
});

route('POST', '/v1/tenant/messaging/sms/estimate', (ctx) => {
  requirePerm(ctx, 'tenant.messaging.read');
  const p = str(ctx.body.provider).trim() || activeSmsProvider(ctx) || 'netgsm';
  if (!(p in PROVIDERS)) notFound('SMS provider');
  return { provider: p, segments: estimateSegments(str(ctx.body.body), p as Provider) };
});

route('PUT', '/v1/tenant/messaging/sms/:provider', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const provider = providerOf(ctx);
  const s = store(ctx);
  const existing = s.get(provider);
  const creds = { ...(existing?.creds ?? {}) };
  const input = (ctx.body.credentials ?? {}) as Record<string, unknown>;
  const allowed = new Set(PROVIDERS[provider].fields.map((f) => f.key));
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.has(k)) fail(400, 'VALIDATION_ERROR', `unknown credential "${k}"`, [{ message: `unknown credential "${k}"` }]);
    const value = str(v).trim();
    if (value.length > 256) fail(400, 'VALIDATION_ERROR', `${k} is too long`, [{ message: `${k} is too long` }]);
    // Empty keeps the stored value.
    if (value) creds[k] = value;
  }
  const sender = ctx.body.sender !== undefined ? str(ctx.body.sender).trim() : (existing?.account.sender ?? '');
  if (!sender) fail(400, 'VALIDATION_ERROR', 'sender is required', [{ message: 'sender is required' }]);
  if (sender.length > 64) fail(400, 'VALIDATION_ERROR', 'sender is too long', [{ message: 'sender is too long' }]);
  const missing = PROVIDERS[provider].fields.filter((f) => f.required && !creds[f.key]).map((f) => f.key);
  if (missing.length) fail(400, 'VALIDATION_ERROR', `${missing.join(', ')} is required`, [{ message: `${missing.join(', ')} is required` }]);
  const at = now();
  const row: Row = existing ?? {
    creds,
    account: { uuid: uuid(), provider, sender, is_active: false, status: 'unchecked', credential_hints: {}, created_at: at, updated_at: at },
  };
  row.creds = creds;
  Object.assign(row.account, { sender, credential_hints: hints(provider, creds), status: 'unchecked', updated_at: at });
  delete row.account.last_error;
  s.set(provider, row);
  const activate = ctx.body.activate;
  if (activate === true || (activate === undefined && !row.account.is_active && !activeSmsProvider(ctx))) setActive(ctx, provider, true);
  else if (activate === false && row.account.is_active) setActive(ctx, provider, false);
  return row.account;
});

route('PATCH', '/v1/tenant/messaging/sms/:provider', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const provider = providerOf(ctx);
  if (typeof ctx.body.is_active !== 'boolean') fail(400, 'VALIDATION_ERROR', 'is_active is required', [{ message: 'is_active is required' }]);
  return setActive(ctx, provider, ctx.body.is_active as boolean);
});

route('DELETE', '/v1/tenant/messaging/sms/:provider', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const provider = providerOf(ctx);
  if (!store(ctx).delete(provider)) notFound('SMS provider account');
  return { success: true };
});

route('POST', '/v1/tenant/messaging/sms/:provider/test', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const provider = providerOf(ctx);
  const row = store(ctx).get(provider) ?? notFound('SMS provider account');
  const ok = credentialsWork(provider, row.creds);
  Object.assign(row.account, { status: ok ? 'connected' : 'error', last_checked_at: now(), updated_at: now() });
  if (ok) {
    delete row.account.last_error;
    return provider === 'netgsm'
      ? { ok, detail: 'Netgsm hesabı doğrulandı', balance: '842,50 TL', sms_credit: 12400, senders: [row.account.sender, 'OTOPOLY'], account: row.account }
      : { ok, detail: 'Twilio account active', balance: '$20.00', account: row.account };
  }
  row.account.last_error = provider === 'netgsm' ? 'Kullanıcı adı veya şifre hatalı (30)' : 'Authenticate (20003)';
  return { ok, error_code: 'sms_auth_failed', message: row.account.last_error, account: row.account };
});

route('POST', '/v1/tenant/messaging/sms/:provider/test-sms', (ctx) => {
  requireOwner(ctx, 'tenant.messaging.write');
  const provider = providerOf(ctx);
  const row = store(ctx).get(provider) ?? notFound('SMS provider account');
  requireFields(ctx.body, ['phone']);
  const to = toE164(str(ctx.body.phone));
  if (!to) validation([{ field: 'phone', message: 'a valid phone number is required' }]);
  const body = str(ctx.body.body).trim() || 'Otopoly test mesajı: SMS kanalınız çalışıyor.';
  if ([...body].length > 1000) fail(400, 'VALIDATION_ERROR', 'message is too long', [{ message: 'message is too long' }]);
  const ok = credentialsWork(provider, row.creds);
  return {
    status: ok ? 'sent' : 'failed',
    provider,
    recipient: maskPhone(to!),
    ...(ok ? { provider_message_id: `${provider === 'netgsm' ? '17' : 'SM'}${uuid().replace(/-/g, '').slice(0, 14)}`, provider_status: 'queued' } : { error_code: 'sms_auth_failed', error_message: 'SMS provider authentication failed' }),
    segments: estimateSegments(body, provider),
  };
});
