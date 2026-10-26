/* Catalog / staff / profile mock routes smoke test. Run:
   npx esbuild scripts/smoke/catalog.smoke.ts --bundle --platform=node --format=cjs --outfile=node_modules/.cache/catalog-smoke.cjs --tsconfig=tsconfig.json --define:__DEV__=false --define:process.env.EXPO_PUBLIC_MOCK_LATENCY='"0"' --alias:@react-native-async-storage/async-storage=./scripts/smoke/stubs.js --alias:expo-secure-store=./scripts/smoke/stubs.js --alias:expo-localization=./scripts/smoke/stubs.js && node node_modules/.cache/catalog-smoke.cjs */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { session } from '@/api/session';

let failures = 0;
const ok = (cond: unknown, msg: string) => { if (!cond) { failures++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
async function expectError(p: Promise<unknown>, code: string, msg: string) {
  try { await p; ok(false, `${msg} (expected ${code})`); } catch (e) { ok((e as { code?: string }).code === code, `${msg} → ${(e as { code?: string }).code}`); }
}
async function login(email: string, password = 'demo1234') {
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const org = me.organizations[0];
  await session.setTokens(await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: org.slug } }), org.slug);
  return me;
}

(async () => {
  await installMockTransport();
  await login('demo@otopoly.com');
  console.log('catalog');
  const cat = await request<any>('POST', '/v1/tenant/catalog/categories', { body: { name: 'Smoke Kat', kind: 'product' } });
  await expectError(request('POST', '/v1/tenant/catalog/categories', { body: { name: 'smoke kat', kind: 'product' } }), 'CONFLICT', 'duplicate category name');
  const p = await request<any>('POST', '/v1/tenant/catalog/products', { body: { name: 'Smoke Ürün', category_uuid: cat.uuid, sku: 'SMK-1', stock_quantity: '5', min_stock_alert: '2' } });
  ok(p.category_name === 'Smoke Kat' && p.stock_status === 'in_stock', 'product created in category');
  await expectError(request('POST', '/v1/tenant/catalog/products', { body: { name: 'Other', sku: 'smk-1' } }), 'CONFLICT', 'duplicate SKU');
  const adj = await request<any>('POST', `/v1/tenant/catalog/products/${p.uuid}/stock-adjustment`, { body: { delta: '-4', reason: 'Fire' } });
  ok(adj.stock_quantity === '1' && adj.stock_status === 'low_stock', `stock adjusted → ${adj.stock_quantity} ${adj.stock_status}`);
  const before = await request<any>('GET', `/v1/tenant/catalog/products/${p.uuid}`);
  await expectError(request('PATCH', `/v1/tenant/catalog/products/${p.uuid}`, { body: { name: 'Renamed', sale_price: '-1' } }), 'VALIDATION_ERROR', 'invalid price rejected');
  ok((await request<any>('GET', `/v1/tenant/catalog/products/${p.uuid}`)).name === before.name, 'failed PATCH left row unchanged');
  const upd = await request<any>('PATCH', `/v1/tenant/catalog/products/${p.uuid}`, { body: { stock_quantity: '10' } });
  ok(upd.stock_quantity === '10' && upd.stock_status === 'in_stock', 'stock_quantity patch');
  const svc = await request<any>('POST', '/v1/tenant/catalog/services', { body: { name: 'Smoke Hizmet', duration_minutes: 30, price: '100', color: 'rose' } });
  const recipe = await request<any>('PUT', `/v1/tenant/catalog/services/${svc.uuid}/products`, { body: { items: [{ product_uuid: p.uuid, qty: '2' }] } });
  ok(recipe.items.length === 1, 'recipe saved');
  await request('DELETE', `/v1/tenant/catalog/services/${svc.uuid}`);
  await request('DELETE', `/v1/tenant/catalog/products/${p.uuid}`);
  await request('DELETE', `/v1/tenant/catalog/categories/${cat.uuid}`);

  console.log('staff');
  await expectError(request('POST', '/v1/tenant/staff', { body: { name: 'A', surname: 'B', email: 'weak@x.com', password: 'abcdefgh' } }), 'VALIDATION_ERROR', 'weak staff password');
  const st = await request<any>('POST', '/v1/tenant/staff', { body: { name: 'Smoke', surname: 'Staff', email: `smoke${Date.now()}@x.com`, password: 'Smoke1234' } });
  ok((await request<any>('PATCH', `/v1/tenant/staff/${st.uuid}`, { body: { status: 'inactive' } })).status === 'inactive', 'staff deactivated');

  console.log('profile');
  const tp = await request<any>('GET', '/v1/tenant/notification-preferences');
  ok(tp.types.length === 6 && tp.types.every((x: any) => x.prefs.inapp), 'tenant prefs defaults (quotes ×4, review.low_score, todo.reminder)');
  await expectError(request('PUT', '/v1/tenant/notification-preferences', { body: { types: [{ type: 'todo.reminder', prefs: { inapp: true, email: false, whatsapp: true, sms: false } }] } }), 'VALIDATION_ERROR', 'whatsapp needs phone');
  const saved = await request<any>('PUT', '/v1/tenant/notification-preferences', { body: { phone: '0555 111 22 33', types: [{ type: 'todo.reminder', prefs: { inapp: true, email: true, whatsapp: true, sms: false } }] } });
  ok(saved.types.find((x: any) => x.type === 'todo.reminder').custom, 'tenant prefs saved');
  const up = await request<any>('PUT', '/v1/notification-preferences', { body: { email_enabled: false, inapp_enabled: true, realtime_enabled: true, push_enabled: false } });
  ok(up.email_enabled === false, 'user prefs saved');
  await expectError(request('PATCH', '/v1/auth/profile', { body: { name: ' ' } }), 'VALIDATION_ERROR', 'blank name rejected');
  await expectError(request('POST', '/v1/auth/password/change', { body: { current_password: 'demo1234', new_password: 'weakpass' } }), 'VALIDATION_ERROR', 'weak new password');
  ok((await request<any>('GET', '/v1/auth/sessions')).items.length > 0, 'sessions listed');

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})();
