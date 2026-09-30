/* Documents area smoke: contracts signing flow + export/import jobs on the mock API.
   Run: npx esbuild scripts/smoke/documents.smoke.ts --bundle --platform=node --format=cjs --outfile=node_modules/.cache/documents-smoke.cjs --tsconfig=tsconfig.json --define:__DEV__=false --define:process.env.EXPO_PUBLIC_MOCK_LATENCY='"0"' --alias:@react-native-async-storage/async-storage=./scripts/smoke/stubs.js --alias:expo-secure-store=./scripts/smoke/stubs.js --alias:expo-localization=./scripts/smoke/stubs.js --log-level=warning && node node_modules/.cache/documents-smoke.cjs */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { session } from '@/api/session';
import { strokesToPngDataUrl } from '@/features/contracts/lib/signature-png';

let failures = 0;
const ok = (cond: unknown, msg: string) => { if (!cond) { failures++; console.log('  ✗', msg); } else console.log('  ✓', msg); };
async function expectError(p: Promise<unknown>, code: string, msg: string) {
  try { await p; ok(false, `${msg} (expected ${code}, got success)`); }
  catch (e) { ok((e as { code?: string }).code === code, `${msg} → ${(e as { code?: string }).code}`); }
}
async function login(email: string) {
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const org = me.organizations[0];
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: org.slug } });
  await session.setTokens(t2, org.slug);
}

(async () => {
  await installMockTransport();
  await login('demo@otopoly.com');
  console.log('contracts');
  const list = await request<any>('GET', '/v1/tenant/contracts/instances', { query: { limit: 20 } });
  ok(list.items.length >= 1, `seeded instances: ${list.items.length}`);
  const tpls = await request<any>('GET', '/v1/tenant/contracts/templates', { query: { is_active: 'true', limit: 100 } });
  ok(tpls.items.length >= 1, `active templates: ${tpls.items.length}`);
  const presets = await request<any>('GET', '/v1/tenant/contracts/presets', { query: { limit: 100 } });
  const cloned = await request<any>('POST', '/v1/tenant/contracts/templates/clone', { body: { preset_uuid: presets.items[0].uuid, title: 'Kopya' } });
  ok(cloned.title === 'Kopya', 'clone preset');
  const patched = await request<any>('PATCH', `/v1/tenant/contracts/templates/${cloned.uuid}`, { body: { title: 'Kopya 2', is_active: false } });
  ok(patched.title === 'Kopya 2' && !patched.is_active && patched.content_html.length > 10, 'patch keeps body');
  await expectError(request('POST', '/v1/tenant/contracts/instances', { body: { template_uuid: cloned.uuid, subject_type: 'service_job', subject_uuid: 'x' } }), 'VALIDATION_ERROR', 'inactive template rejected');
  await request('DELETE', `/v1/tenant/contracts/templates/${cloned.uuid}`);
  const jobs = await request<any>('GET', '/v1/tenant/jobs', { query: { limit: 1 } });
  const inst = await request<any>('POST', '/v1/tenant/contracts/instances', { body: { template_uuid: tpls.items.find((x: any) => x.otp_required).uuid, subject_type: 'service_job', subject_uuid: jobs.items[0].uuid } });
  ok(inst.status === 'pending' && inst.signers.length === 2 && !inst.content_html.includes('{{'), 'instance created with resolved vars');
  const customer = inst.signers.find((s: any) => s.role === 'customer');
  const staff = inst.signers.find((s: any) => s.role === 'staff');
  const png = strokesToPngDataUrl([[{ x: 1, y: 1 }, { x: 50, y: 30 }]], 100, 50);
  await expectError(request('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${customer.uuid}/sign`, { body: { display_name: 'A', signature_png_base64: png } }), 'OTP_REQUIRED', 'customer sign needs OTP');
  const ch = await request<any>('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${customer.uuid}/otp`, { body: {} });
  ok(ch.phone_masked, `otp sent to ${ch.phone_masked}`);
  await expectError(request('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${customer.uuid}/otp`, { body: {} }), 'RATE_LIMITED', 'resend cooldown');
  await expectError(request('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${customer.uuid}/otp/verify`, { body: { code: '000000' } }), 'INVALID_OTP_CODE', 'wrong code');
  const v = await request<any>('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${customer.uuid}/otp/verify`, { body: { code: '123456' } });
  ok(v.signers.find((s: any) => s.uuid === customer.uuid).otp_verified, 'otp verified');
  await request('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${customer.uuid}/sign`, { body: { display_name: 'Müşteri', signature_png_base64: png } });
  const done = await request<any>('POST', `/v1/tenant/contracts/instances/${inst.uuid}/signers/${staff.uuid}/sign`, { body: { display_name: 'Personel', signature_png_base64: png } });
  ok(done.status === 'executed' && done.pdf_url, 'executed after all signatures');
  await expectError(request('POST', `/v1/tenant/contracts/instances/${inst.uuid}/void`), 'CONFLICT', 'executed cannot be voided');

  console.log('exports / imports');
  const job = await request<any>('POST', '/v1/tenant/jobs/export', { body: { format: 'xlsx', query: { q: '34' }, locale: 'tr' } });
  ok(job.status === 'pending', 'export queued');
  await expectError(request('POST', '/v1/tenant/jobs/export', { body: { format: 'doc' } }), 'VALIDATION_ERROR', 'bad format');
  const exps = await request<any>('GET', '/v1/tenant/exports');
  ok(exps.items.length >= 4, `export jobs: ${exps.items.length}`);
  const imps = await request<any>('GET', '/v1/tenant/imports');
  const applied = imps.items.find((x: any) => x.status === 'applied' && Date.parse(x.rollback_until) > Date.now());
  const rb = await request<any>('POST', `/v1/tenant/imports/${applied.uuid}/rollback`);
  ok(rb.status === 'rolled_back', 'rollback');
  await expectError(request('POST', `/v1/tenant/imports/${applied.uuid}/rollback`), 'CONFLICT', 'rollback twice');

  await login('personel@otopoly.com');
  await expectError(request('GET', '/v1/tenant/imports'), 'FORBIDDEN', 'staff cannot list imports');
  await expectError(request('POST', `/v1/tenant/contracts/templates`, { body: { title: 'x' } }), 'FORBIDDEN', 'staff cannot create templates');

  console.log(failures ? `\n${failures} failure(s)` : '\nall documents checks passed');
  process.exit(failures ? 1 : 0);
})();
