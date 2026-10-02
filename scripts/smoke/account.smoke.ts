/* Wave 3b smoke test: linked accounts, tenant access states, quotes module lock, read-only plan,
 * assistant confirm cards / plans and the AI data-sharing consent, through the real client against
 * the mock. Run via `npm run test:smoke`. */
import { request } from '@/api/client';
import { ApiError, isApiError, isFeatureDisabled, isPlanBlocked, isReadOnly } from '@/api/errors';
import { subscribeApiEvents } from '@/api/events';
import { installMockTransport } from '@/api/mock';
import { DEMO_IDENTITIES, demoIdToken } from '@/api/mock/demo-auth';
import { setAccessScenario, setPlanScenario } from '@/api/mock/scenario';
import { session, type Tokens } from '@/api/session';
import { identityErrorKey, unlinkBlock } from '@/features/account/lib/identities';
import { identitiesService } from '@/features/account/services/identities.service';
import { AI_CONSENT_VERSION, consentValid, loadConsent, providerLabelKey, revokeConsent, saveConsent } from '@/features/ai/consent';
import { actionErrorKey, confirmFieldKey, confirmStatusKey, toolLabelKey } from '@/features/ai/lib/labels';
import { replaceCard } from '@/features/ai/lib/blocks';
import { aiService } from '@/features/ai/services/ai.service';
import type { AIConfirmCard, AIPlan, AIUIBlock } from '@/features/ai/types';
import { accessCopyKeys, orgBlock } from '@/features/auth/lib/access';
import { passwordlessService } from '@/features/auth/services/passwordless.service';
import { moduleName, readOnlyMessageKey } from '@/features/billing/lib';
import { hasTranslation, translate, type AppLocale } from '@/lib/i18n/translate';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function caught(p: Promise<unknown>): Promise<ApiError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return isApiError(e) ? e : null;
  }
}
async function expectCode(p: Promise<unknown>, code: string, msg: string) {
  const e = await caught(p);
  ok(e?.code === code, `${msg} → ${e?.code ?? 'success'}`);
  return e;
}
const me = () => request<any>('GET', '/v1/auth/me', { silent: true });
async function login(email: string) {
  const t = await request<Tokens>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true, silent: true });
  await session.setTokens(t, null);
  const profile = await me();
  const t2 = await request<Tokens>('POST', '/v1/auth/organization-context', { body: { organization_slug: profile.organizations[0].slug }, silent: true });
  await session.setTokens(t2, profile.organizations[0].slug);
  return profile;
}
const identity = (sub: string) => DEMO_IDENTITIES.find((i) => i.sub === sub)!;
const idt = (sub: string) => {
  const nonce = Math.random().toString(36).slice(2);
  return { id_token: demoIdToken(identity(sub), nonce), nonce };
};
const LOCALES: AppLocale[] = ['tr', 'en'];
const PURCHASE_WORDS = /yükselt|satın|fiyat|ödeme yap|abone ol|yenile|upgrade|purchase|buy|price|subscribe|renew/i;
const allKeys = (keys: string[], msg: string) => {
  const missing = keys.flatMap((k) => LOCALES.filter((l) => !hasTranslation(l, k)).map((l) => `${l}:${k}`));
  ok(missing.length === 0, `${msg}${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
};
const neutral = (keys: string[], msg: string) => {
  const bad = keys.flatMap((k) => LOCALES.map((l) => translate(l, k, { name: 'X', provider: 'Y', date: 'Z' })).filter((s) => PURCHASE_WORDS.test(s)));
  ok(bad.length === 0, `${msg}${bad.length ? ` (${bad.join(' | ')})` : ''}`);
};

(async () => {
  await installMockTransport();

  // ─── Linked accounts ──────────────────────────────────────────────────────
  console.log('linked accounts (owner with a password)');
  await login('demo@otopoly.com');
  let list = await identitiesService.list();
  ok(list.items.some((i) => i.provider === 'apple') && list.has_password === true, 'owner: Apple linked, has a password');
  ok(unlinkBlock(list, 'apple') === null, 'with a password the last provider can go');
  const linked = await identitiesService.linkNative('google', idt('google-unlinked'));
  ok(linked.provider === 'google' && Boolean(linked.linked_at), 'link Google with a native id_token');
  list = await identitiesService.list();
  ok(list.total === 2, 'list shows Apple + Google');
  await expectCode(identitiesService.linkNative('google', idt('google-unlinked')).then(() => identitiesService.linkNative('apple', idt('apple-relay-new'))), 'CONFLICT', 'second Apple identity on the same account');
  await expectCode(identitiesService.linkNative('apple', { id_token: 'garbage' }), 'INVALID_ID_TOKEN', 'bad id_token');
  await expectCode(identitiesService.linkNative('google', { ...idt('google-unlinked'), nonce: 'other' }), 'INVALID_ID_TOKEN', 'nonce mismatch');
  ok((await identitiesService.unlink('google')).status === 'unlinked', 'unlink Google');
  await expectCode(identitiesService.unlink('google'), 'NOT_FOUND', 'unlink again');
  // Signing in with Google again (now unlinked) is the not-linked case the notice points to the profile for.
  await expectCode(passwordlessService.nativeOAuth('google', idt('google-unlinked')), 'OAUTH_ACCOUNT_NOT_LINKED', 'unlinked Google sign-in');

  console.log('linked accounts (Apple-only account, no password)');
  const choice = await caught(passwordlessService.nativeOAuth('apple', idt('apple-relay-new')));
  const ticket = choice?.details.find((d) => d.field === 'link_ticket')?.message ?? '';
  await session.setTokens(await passwordlessService.createFromLink(ticket), null);
  list = await identitiesService.list();
  ok(list.has_password === false && list.total === 1, 'new Apple account: no password, one identity');
  ok(unlinkBlock(list, 'apple') === 'last_method', 'client blocks removing the last sign-in method');
  await expectCode(identitiesService.unlink('apple'), 'LAST_SIGN_IN_METHOD', 'server refuses it too');
  await expectCode(identitiesService.linkNative('apple', idt('apple-linked')), 'IDENTITY_ALREADY_LINKED', "someone else's Apple identity");
  await identitiesService.linkNative('google', idt('google-unlinked'));
  list = await identitiesService.list();
  ok(unlinkBlock(list, 'apple') === null, 'with Google linked, Apple can go');
  ok((await identitiesService.unlink('apple')).status === 'unlinked', 'unlink Apple');
  ok(unlinkBlock(await identitiesService.list(), 'google') === 'last_method', 'Google is now the last method');
  ok(unlinkBlock({ items: [{ provider: 'apple', linked_at: '' }], total: 1 }, 'apple') === null, 'no has_password from the server → server decides');
  allKeys(
    ['IDENTITY_ALREADY_LINKED', 'CONFLICT', 'LAST_SIGN_IN_METHOD', 'INVALID_ID_TOKEN', 'OAUTH_PROVIDER_DISABLED', 'NOT_FOUND', 'NETWORK_ERROR', 'X'].map(identityErrorKey),
    'link / unlink error copy exists',
  );
  ok(translate('tr', 'mobile.auth.not_linked.body', { provider: 'Apple' }).includes('Bağlı hesaplar'), 'not-linked notice points to Profile → Bağlı hesaplar');

  // ─── Tenant access states ─────────────────────────────────────────────────
  console.log('tenant access states');
  await login('demo@otopoly.com');
  ok((await request<any>('GET', '/v1/tenant/jobs', { silent: true })).items !== undefined, 'normal: tenant routes work');
  setAccessScenario('expired');
  await expectCode(request('GET', '/v1/tenant/jobs', { silent: true }), 'ORGANIZATION_ACCESS_EXPIRED', 'expired: tenant route');
  let profile = await me();
  ok(orgBlock(profile.organizations[0]) === 'expired', 'expired: /me shows access_ends_at in the past');
  await expectCode(request('POST', '/v1/auth/organization-context', { body: { organization_slug: profile.organizations[0].slug }, silent: true }), 'ORGANIZATION_ACCESS_EXPIRED', 'expired: org context');
  setAccessScenario('suspended');
  await expectCode(request('GET', '/v1/tenant/jobs', { silent: true }), 'FORBIDDEN', 'suspended: tenant route (backend answers FORBIDDEN)');
  profile = await me();
  ok(orgBlock(profile.organizations[0]) === 'suspended', 'suspended: /me status');
  setAccessScenario('removed');
  await expectCode(request('GET', '/v1/tenant/jobs', { silent: true }), 'NO_TENANT_MEMBERSHIP', 'removed: tenant route');
  ok((await me()).organizations.length === 0, 'removed: no memberships');
  setAccessScenario('normal');
  ok(orgBlock((await me()).organizations[0]) === null, 'back to normal');
  const accessKeys = (['denied', 'expired', 'suspended'] as const).flatMap((s) => [true, false].flatMap((o) => Object.values(accessCopyKeys(s, o))));
  allKeys([...accessKeys, 'mobile.access.expired_badge', 'mobile.access.suspended_badge', 'mobile.access.switch', 'mobile.access.retry'], 'access copy exists');
  neutral(accessKeys.filter((k) => k.startsWith('mobile.')), 'access copy has no purchase / renewal wording');
  ok(translate('tr', accessCopyKeys('expired', true).body, { name: 'X' }).includes('e-posta') && translate('tr', accessCopyKeys('expired', false).body, { name: 'X' }).includes('yönetici'), 'owner: details e-mailed / staff: ask the manager');

  // ─── Quotes module lock ───────────────────────────────────────────────────
  console.log('module.quotes');
  setPlanScenario('quotes_disabled');
  for (const path of ['/v1/tenant/quotes', '/v1/tenant/quotes/summary', '/v1/tenant/leads', '/v1/tenant/leads/summary']) {
    ok(isFeatureDisabled(await caught(request('GET', path, { silent: true }))), `${path} → FEATURE_DISABLED`);
  }
  ok((await request<any>('GET', '/v1/tenant/jobs', { silent: true })).items !== undefined, 'other modules keep working');
  const ov = await request<any>('GET', '/v1/tenant/billing/overview', { silent: true });
  ok(ov.meters.find((m: any) => m.key === 'module.quotes').enabled === false, 'usage screen shows the module off');
  ok(moduleName((k) => translate('tr', k), 'module.quotes') === 'Teklif ve fırsat modülü', 'lock state names the module');
  await login('personel@otopoly.com');
  ok(isFeatureDisabled(await caught(request('GET', '/v1/tenant/leads/summary', { silent: true }))), 'staff sees the lock too (feature before permission)');

  // ─── Read-only plan ───────────────────────────────────────────────────────
  console.log('SUBSCRIPTION_READ_ONLY');
  setPlanScenario('read_only');
  await login('demo@otopoly.com');
  const events: string[] = [];
  const off = subscribeApiEvents((e) => events.push(e.code));
  const ro = await caught(request('POST', '/v1/tenant/customers', { body: { name: 'Salt Okunur', phone: '05550000000', kind: 'individual' } }));
  ok(isReadOnly(ro) && isPlanBlocked(ro), 'write → 403 SUBSCRIPTION_READ_ONLY (plan dialog, no toast)');
  ok(events.includes('SUBSCRIPTION_READ_ONLY'), 'reaches the API error bus (shared plan dialog)');
  off();
  ok((await request<any>('GET', '/v1/tenant/customers', { silent: true })).items !== undefined, 'reads still work');
  const ov2 = await request<any>('GET', '/v1/tenant/billing/overview', { silent: true });
  ok(ov2.read_only === true && ov2.subscription.status === 'read_only', 'usage screen shows read-only');
  const roKeys = ['mobile.plan.read_only_dialog.title', readOnlyMessageKey(true), readOnlyMessageKey(false)];
  allKeys(roKeys, 'read-only dialog copy exists');
  neutral(roKeys, 'read-only copy has no purchase / renewal wording');
  setPlanScenario('normal');

  // ─── Assistant: confirm cards + plan ──────────────────────────────────────
  console.log('assistant actions');
  const status = await aiService.status();
  ok(status.features.actions && status.features.todos && status.provider === 'anthropic', 'status: actions + todos on, provider anthropic');
  const conv = await aiService.createConversation();
  const turn = await aiService.sendMessage(conv.uuid, 'Yarın lastik siparişini hatırlat', 'tr');
  const blocks = turn.message.blocks;
  const plan = blocks.find((b) => b.type === 'todo_list');
  const card = blocks.find((b) => b.type === 'confirm');
  const chip = blocks.find((b) => b.type === 'tool' && b.name === 'create_todo');
  ok(plan && (plan.data as AIPlan).items.some((i) => i.status === 'in_progress'), 'plan checklist with a step in progress');
  ok(card?.status === 'pending' && chip?.status === 'pending', 'pending confirm card + pending tool chip');
  const preview = (card?.data as AIConfirmCard).preview;
  ok(preview.action === 'create_todo' && preview.title.toLowerCase().includes('lastik') && (preview.edit ?? []).some((f) => f.key === 'title'), `editable create_todo card ("${preview.title}")`);
  const done = await aiService.confirmAction(card!.id!, { title: 'Lastik siparişi ver' }, 'tr');
  const result = (done.block.data as AIConfirmCard).result;
  ok(done.block.status === 'confirmed' && result?.ok && result.link?.kind === 'todo', 'confirm → confirmed, link to the todo');
  ok(done.message?.blocks.some((b) => b.type === 'text'), 'follow-up message');
  const todos = await request<any>('GET', '/v1/tenant/todos', { silent: true });
  const todo = (todos.items ?? []).find((t: any) => t.uuid === result?.link?.uuid);
  ok(todo?.title === 'Lastik siparişi ver' && todo.via_ai === true, 'todo created with the edited title, via_ai');
  const detail = await aiService.getConversation(conv.uuid);
  const stored = detail.messages.find((m) => m.uuid === turn.message.uuid)!;
  ok((stored.blocks.find((b) => b.type === 'todo_list')!.data as AIPlan).items.every((i) => i.status === 'done'), 'plan finished in the stored message');
  ok(stored.blocks.find((b) => b.type === 'tool' && b.name === 'create_todo')?.status === 'done', 'tool chip done');
  await expectCode(aiService.confirmAction(card!.id!, undefined, 'tr'), 'AI_ACTION_RESOLVED', 'confirm twice');
  const second = await aiService.sendMessage(conv.uuid, 'Remind me to call the supplier', 'en');
  const card2 = second.message.blocks.find((b) => b.type === 'confirm')!;
  await expectCode(aiService.confirmAction(card2.id!, { title: '  ' }, 'en'), 'VALIDATION_ERROR', 'empty edited title');
  const cancelled = await aiService.cancelAction(card2.id!);
  ok(cancelled.block.status === 'cancelled', 'cancel → cancelled');
  await expectCode(aiService.cancelAction(card2.id!), 'AI_ACTION_RESOLVED', 'cancel twice');
  await expectCode(aiService.confirmAction('00000000-0000-4000-8000-000000000000', undefined, 'tr'), 'NOT_FOUND', 'unknown action');
  const replaced = replaceCard([turn.message], { ...card!, status: 'cancelled' } as AIUIBlock);
  ok(replaced[0].blocks.find((b) => b.type === 'tool' && b.name === 'create_todo')?.status === 'cancelled', 'client replaceCard updates the tool chip');
  allKeys(
    [toolLabelKey('create_todo'), toolLabelKey('update_plan'), confirmFieldKey('title'), confirmFieldKey('due_date'), confirmFieldKey('zzz'), confirmStatusKey('executing'), actionErrorKey('AI_ACTION_EXPIRED'), actionErrorKey('SUBSCRIPTION_READ_ONLY'), 'ai.plan.progress', 'ai.confirm.save_confirm'].concat(
      ['pending', 'in_progress', 'done', 'skipped'].map((s) => `mobile.ai.plan_status.${s}`),
    ),
    'confirm card / plan copy exists',
  );

  // ─── AI data-sharing consent ──────────────────────────────────────────────
  console.log('AI consent');
  const user = (await me()).user.uuid as string;
  ok((await loadConsent(user)) === null, 'no consent stored at first');
  const given = await saveConsent(user, 'anthropic');
  ok(given.version === AI_CONSENT_VERSION && consentValid(await loadConsent(user), 'anthropic'), 'consent stored per user');
  ok(!consentValid(given, 'openai_compatible'), 'another provider asks again');
  ok(!consentValid({ ...given, version: AI_CONSENT_VERSION - 1 }, 'anthropic'), 'older disclosure version asks again');
  ok((await loadConsent('someone-else')) === null, 'other users are not covered');
  await revokeConsent(user);
  ok((await loadConsent(user)) === null, 'withdrawn from preferences');
  const consentKeys = [
    'title', 'intro', 'provider_title', 'provider_body', 'sent_title', 'sent_body', 'records_title', 'records_body', 'not_sent_title', 'not_sent_body',
    'control_title', 'control_body', 'footnote', 'accept', 'decline', 'provider_unknown', 'prefs_title', 'prefs_label', 'status_on', 'status_off',
    'prefs_given', 'prefs_none', 'revoke', 'revoked',
  ].map((k) => `mobile.ai.consent.${k}`);
  allKeys([...consentKeys, providerLabelKey('anthropic')!, providerLabelKey('openai_compatible')!], 'consent copy exists');
  neutral(consentKeys, 'consent copy has no purchase wording');
  ok(translate('tr', 'mobile.ai.consent.provider_body', { provider: translate('tr', providerLabelKey('anthropic')!) }).includes('Anthropic'), 'disclosure names the provider');
  ok(providerLabelKey('something') === null, 'unknown provider is shown as reported');

  console.log(failures ? `\n${failures} FAILED` : '\nall account checks passed');
  process.exit(failures ? 1 : 0);
})();
