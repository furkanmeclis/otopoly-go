/**
 * Profile-side account routes: notification preferences (user + per-organization), e-mail verification request.
 * Owned by the catalog/staff/profile area. Profile/password/sessions live in `auth.ts`.
 */
import type { NotificationChannelPrefs, NotificationTypePreferences } from '@/features/account/services/tenant-notification-preferences.service';
import type { NotificationPreferences } from '@/features/account/services/notification-preferences.service';

import { fail, route, str, validation, type MockCtx } from '../core';
import { getDb, type MockDb } from '../db';

/** Same rule as backend `password.ValidatePassword`: ≥ 8 chars with upper, lower and digit. */
export function assertPasswordPolicy(value: string, field: string) {
  if (value.length < 8) validation([{ field, message: 'must be at least 8 characters', code: 'min' }]);
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    validation([{ field, message: 'must include upper, lower, and digit characters', code: 'policy' }]);
  }
}

// Extra rows kept on the persisted DB object (lazily created, no shared schema change).
type AccountExt = {
  _notificationPrefs?: Record<string, NotificationPreferences>;
  _notificationMember?: Record<string, { phone: string; types: Record<string, NotificationChannelPrefs> }>;
};
const ext = () => getDb() as MockDb & AccountExt;

function userOf(ctx: MockCtx) {
  if (!ctx.user) fail(401, 'UNAUTHENTICATED', 'Authentication required');
  return ctx.user!;
}

// ─── User notification preferences (/v1/notification-preferences) ─────────

const USER_DEFAULTS: NotificationPreferences = { email_enabled: true, inapp_enabled: true, realtime_enabled: true, push_enabled: false };

route('GET', '/v1/notification-preferences', (ctx) => {
  const user = userOf(ctx);
  return ext()._notificationPrefs?.[user.uuid] ?? USER_DEFAULTS;
});

route('PUT', '/v1/notification-preferences', (ctx) => {
  const user = userOf(ctx);
  const b = ctx.body;
  const bad = (['email_enabled', 'inapp_enabled', 'realtime_enabled', 'push_enabled'] as const).filter((k) => typeof b[k] !== 'boolean');
  if (bad.length) validation(bad.map((field) => ({ field, message: 'must be a boolean', code: 'invalid' })));
  const next: NotificationPreferences = {
    email_enabled: b.email_enabled as boolean,
    inapp_enabled: b.inapp_enabled as boolean,
    realtime_enabled: b.realtime_enabled as boolean,
    push_enabled: b.push_enabled as boolean,
  };
  const db = ext();
  db._notificationPrefs = { ...db._notificationPrefs, [user.uuid]: next };
  return next;
});

// ─── Per-organization notification types (/v1/tenant/notification-preferences) ─

type Channel = keyof NotificationChannelPrefs;
/** msgtemplate types with `UserPreference: true` (backend registry order). */
const USER_TYPES: { type: string; channels: Channel[] }[] = [
  { type: 'quote.team_created', channels: ['inapp', 'email'] },
  { type: 'quote.team_expiring', channels: ['inapp', 'email'] },
  { type: 'quote.team_accepted', channels: ['inapp', 'email'] },
  { type: 'quote.team_rejected', channels: ['inapp', 'email'] },
  { type: 'todo.reminder', channels: ['inapp', 'email', 'whatsapp', 'sms'] },
];
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

/** Backend `DefaultPrefs`: in-app on, e-mail/SMS off, WhatsApp on only with a phone. */
const defaultPrefs = (phone: string): NotificationChannelPrefs => ({ inapp: true, email: false, whatsapp: phone.trim() !== '', sms: false });

function memberKey(ctx: MockCtx) {
  if (!ctx.orgUuid) fail(403, 'ORGANIZATION_CONTEXT_REQUIRED', 'Organization context required');
  return `${userOf(ctx).uuid}:${ctx.orgUuid}`;
}

function memberPrefs(key: string): NotificationTypePreferences {
  const row = ext()._notificationMember?.[key];
  const phone = row?.phone ?? '';
  return {
    phone,
    types: USER_TYPES.map((spec) => {
      const stored = row?.types[spec.type];
      return { type: spec.type, channels: spec.channels, prefs: stored ?? defaultPrefs(phone), custom: Boolean(stored) };
    }),
  };
}

route('GET', '/v1/tenant/notification-preferences', (ctx) => memberPrefs(memberKey(ctx)));

route('PUT', '/v1/tenant/notification-preferences', (ctx) => {
  const key = memberKey(ctx);
  const db = ext();
  const row = { phone: '', types: {} as Record<string, NotificationChannelPrefs>, ...db._notificationMember?.[key] };
  let phone = row.phone;
  if (ctx.body.phone !== undefined) {
    phone = str(ctx.body.phone).trim();
    if (phone && !PHONE_RE.test(phone)) fail(400, 'VALIDATION_ERROR', 'phone is invalid', [{ field: 'phone', message: 'invalid', code: 'invalid' }]);
  }
  const types = Array.isArray(ctx.body.types) ? (ctx.body.types as { type: string; prefs: Partial<NotificationChannelPrefs> }[]) : [];
  const nextTypes = { ...row.types };
  types.forEach((t, i) => {
    const spec = USER_TYPES.find((s) => s.type === t.type);
    if (!spec) fail(400, 'VALIDATION_ERROR', `unknown notification type "${t.type}"`, [{ field: `types[${i}].type`, message: 'unknown', code: 'invalid' }]);
    const p = t.prefs ?? {};
    if ((p.whatsapp || p.sms) && !phone) fail(400, 'VALIDATION_ERROR', 'a phone number is required for WhatsApp/SMS', [{ field: 'phone', message: 'required', code: 'required' }]);
    const has = (c: Channel) => spec!.channels.includes(c);
    nextTypes[t.type] = { inapp: Boolean(p.inapp) && has('inapp'), email: Boolean(p.email) && has('email'), whatsapp: Boolean(p.whatsapp) && has('whatsapp'), sms: Boolean(p.sms) && has('sms') };
  });
  db._notificationMember = { ...db._notificationMember, [key]: { phone, types: nextTypes } };
  return memberPrefs(key);
});

// ─── E-mail verification ───────────────────────────────────────────────────

route('POST', '/v1/auth/email/verify-request', (ctx) => {
  userOf(ctx);
  return { status: 'ok' };
});
