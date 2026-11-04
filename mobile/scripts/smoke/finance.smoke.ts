/* Finance mock routes smoke (category patch/delete, transfer currency rule, account validation). */
import { request } from '@/api/client';
import { session } from '@/api/session';
import { installMockTransport } from '@/api/mock';

let failures = 0;
const ok = (cond: unknown, msg: string) => { if (!cond) failures++; console.log(cond ? '  ✓' : '  ✗', msg); };
async function expectError(p: Promise<unknown>, code: string, msg: string) {
  try { await p; ok(false, `${msg} (expected ${code})`); } catch (e) { ok((e as { code?: string }).code === code, `${msg} → ${(e as { code?: string }).code}`); }
}

(async () => {
  await installMockTransport();
  const t = await request<any>('POST', '/v1/auth/login', { body: { email: 'demo@otopoly.com', password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);

  console.log('finance');
  await expectError(request('POST', '/v1/tenant/finance/accounts', { body: { name: 'X', type: 'cash', currency: 'TL' } }), 'VALIDATION_ERROR', 'bad currency rejected');
  const usd = await request<any>('POST', '/v1/tenant/finance/accounts', { body: { name: 'USD Kasa', type: 'cash', currency: 'usd' } });
  ok(usd.currency === 'USD', 'currency upper-cased');
  const accounts = await request<any>('GET', '/v1/tenant/finance/accounts', { query: { is_active: 'true' } });
  const tryAcc = accounts.items.find((a: any) => a.currency === 'TRY');
  await expectError(request('POST', '/v1/tenant/finance/transfers', { body: { from_account_uuid: tryAcc.uuid, to_account_uuid: usd.uuid, amount: '10' } }), 'CURRENCY_MISMATCH', 'cross-currency transfer rejected');
  const patched = await request<any>('PATCH', `/v1/tenant/finance/accounts/${usd.uuid}`, { body: { is_default: true } });
  const after = await request<any>('GET', '/v1/tenant/finance/accounts', { query: { limit: 100 } });
  ok(patched.is_default && after.items.filter((a: any) => a.is_default).length === 1, 'single default account org-wide');
  const cat = await request<any>('POST', '/v1/tenant/finance/categories', { body: { name: 'Smoke Kat', kind: 'expense' } });
  const cp = await request<any>('PATCH', `/v1/tenant/finance/categories/${cat.uuid}`, { body: { name: 'Smoke Kat 2', is_active: false, sort_order: 99 } });
  ok(cp.name === 'Smoke Kat 2' && !cp.is_active && cp.sort_order === 99, 'category patched');
  await request('DELETE', `/v1/tenant/finance/categories/${cat.uuid}`);
  await expectError(request('GET', `/v1/tenant/finance/categories/${cat.uuid}`), 'NOT_FOUND', 'category deleted');
  const list = await request<any>('GET', '/v1/tenant/finance/transactions', { query: { currency: 'usd' } });
  ok(list.items.every((x: any) => x.currency === 'USD'), 'currency filter');

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})();
