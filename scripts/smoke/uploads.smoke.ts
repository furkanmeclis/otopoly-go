/* Uploads smoke (wave 3a): import wizard (upload → mapping → preview → confirm → rollback), contract
   media uploads (multipart mock path, type / size rules) and the job contracts flow on the mock API.
   Run with `npm run test:smoke` (scripts/smoke/run-all.mjs bundles every *.smoke.ts). */
import { request } from '@/api/client';
import { installMockTransport, mockFormRequest } from '@/api/mock';
import { session } from '@/api/session';
import { countMappedFields, hasDuplicateHeader, MAPPING_SKIP, suggestColumnMapping, uiMappingToApi } from '@/features/io/lib/suggest-mapping';
import { IMPORT_SCHEMA } from '@/features/io/types';

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
/** React Native's FormData keeps parts in `_parts`; the mock multipart path reads them. */
const rnForm = (parts: [string, unknown][]) => ({ _parts: parts }) as unknown as FormData;
const file = (name: string, type: string, size = 1000) => ({ uri: `file:///cache/${name}`, name, type, size });

(async () => {
  await installMockTransport();

  console.log('column matching');
  const schema = IMPORT_SCHEMA['tenant.finance.accounts']!;
  const labels: Record<string, string> = { 'finance.accounts.name': 'Hesap adı', 'finance.accounts.iban': 'IBAN' };
  const ui = suggestColumnMapping(['Hesap adı', 'IBAN', 'currency', 'Bilinmeyen'], schema, (k) => labels[k] ?? k);
  ok(ui.name === 'Hesap adı' && ui.iban === 'IBAN' && ui.currency === 'currency', `auto-match ${JSON.stringify(ui)}`);
  ok(countMappedFields({ ...ui, notes: MAPPING_SKIP }) === 3, 'skip is not counted');
  ok(hasDuplicateHeader({ name: 'A', notes: 'A' }) && !hasDuplicateHeader({ name: 'A', notes: MAPPING_SKIP }), 'duplicate header check');
  ok(JSON.stringify(uiMappingToApi({ name: 'Hesap adı', notes: MAPPING_SKIP })) === '{"Hesap adı":"name"}', 'ui → api mapping');

  console.log('imports wizard');
  await login('demo@otopoly.com');
  const job = await mockFormRequest<any>('POST', '/v1/tenant/finance/accounts/import', rnForm([['file', file('kasalar.csv', 'text/csv')], ['format', 'csv'], ['locale', 'tr']]));
  ok(job.status === 'uploaded' && job.resource === 'tenant.finance.accounts', 'upload via multipart (owner)');
  ok(Object.values(job.mapping).includes('name'), `server suggested mapping: ${Object.keys(job.mapping).length} columns`);
  await expectError(mockFormRequest('POST', '/v1/tenant/finance/accounts/import', rnForm([['format', 'csv']])), 'VALIDATION_ERROR', 'file is required');
  await expectError(mockFormRequest('POST', '/v1/tenant/finance/categories/import', rnForm([['file', file('a.doc', 'application/msword')], ['format', 'doc']])), 'VALIDATION_ERROR', 'unsupported format');
  await expectError(request('POST', `/v1/tenant/imports/${job.uuid}/preview`), 'VALIDATION_ERROR', 'preview before mapping');
  await expectError(request('PATCH', `/v1/tenant/imports/${job.uuid}/mapping`, { body: { mapping: { X: 'nope' } } }), 'VALIDATION_ERROR', 'unknown target field');

  // Leave the required `type` unmapped and without a default → every row fails.
  const noType = Object.fromEntries(Object.entries(job.mapping).filter(([, f]) => f !== 'type'));
  await request('PATCH', `/v1/tenant/imports/${job.uuid}/mapping`, { body: { mapping: noType, defaults: {} } });
  const bad = await request<any>('POST', `/v1/tenant/imports/${job.uuid}/preview`);
  ok(bad.status === 'previewed' && bad.preview_summary.valid === 0 && bad.preview_summary.errors.length === bad.preview_summary.total, 'missing required → all rows invalid');

  const mapped = await request<any>('PATCH', `/v1/tenant/imports/${job.uuid}/mapping`, { body: { mapping: noType, defaults: { type: 'cash' } } });
  ok(mapped.status === 'mapped' && mapped.defaults.type === 'cash' && !mapped.preview_summary, 'remap resets preview');
  await expectError(request('POST', `/v1/tenant/imports/${job.uuid}/confirm`), 'VALIDATION_ERROR', 'confirm before preview');
  const pv = await request<any>('POST', `/v1/tenant/imports/${job.uuid}/preview`);
  ok(pv.preview_summary.valid === pv.preview_summary.total - 1 && pv.preview_summary.invalid === 1, `preview ${pv.preview_summary.valid}/${pv.preview_summary.total} valid`);
  const queued = await request<any>('POST', `/v1/tenant/imports/${job.uuid}/confirm`);
  ok(queued.status === 'queued', 'confirm queues the job');
  await expectError(request('PATCH', `/v1/tenant/imports/${job.uuid}/mapping`, { body: { mapping: noType } }), 'VALIDATION_ERROR', 'queued job is not editable');

  const realNow = Date.now;
  Date.now = () => realNow() + 2000;
  ok((await request<any>('GET', `/v1/tenant/imports/${job.uuid}`)).status === 'applying', 'worker: applying');
  Date.now = () => realNow() + 5000;
  const applied = await request<any>('GET', `/v1/tenant/imports/${job.uuid}`);
  ok(applied.status === 'applied' && applied.applied_at && Date.parse(applied.rollback_until) > Date.now(), 'worker: applied with rollback window');
  const rb = await request<any>('POST', `/v1/tenant/imports/${job.uuid}/rollback`);
  ok(rb.status === 'rolled_back', 'rollback of the new import');
  Date.now = realNow;
  const list = await request<any>('GET', '/v1/tenant/imports');
  ok(list.items[0].uuid === job.uuid, 'new job listed first');

  console.log('contract media');
  const tpls = await request<any>('GET', '/v1/tenant/contracts/templates', { query: { is_active: 'true', limit: 100 } });
  const jobs = await request<any>('GET', '/v1/tenant/jobs', { query: { limit: 5, status: 'in_progress' } });
  const jobUuid = jobs.items[0].uuid;
  const tpl = tpls.items.find((x: any) => !x.signature_required) ?? tpls.items[0];
  const inst = await request<any>('POST', '/v1/tenant/contracts/instances', { body: { template_uuid: tpl.uuid, subject_type: 'service_job', subject_uuid: jobUuid, defer_execute: true } });
  ok(inst.status === 'pending', 'deferred create stays open for photos');
  const media = await mockFormRequest<any>('POST', `/v1/tenant/contracts/instances/${inst.uuid}/media`, rnForm([['file', file('on.jpg', 'image/jpeg', 2_000_000)], ['caption', 'Ön']]));
  ok(media.content_type === 'image/jpeg' && media.caption === 'Ön' && media.byte_size === 2_000_000, 'photo uploaded with caption');
  await mockFormRequest('POST', `/v1/tenant/contracts/instances/${inst.uuid}/media`, rnForm([['file', file('ruhsat.pdf', 'application/pdf')]]));
  await expectError(mockFormRequest('POST', `/v1/tenant/contracts/instances/${inst.uuid}/media`, rnForm([['file', file('a.heic', 'image/heic')]])), 'VALIDATION_ERROR', 'HEIC rejected');
  await expectError(mockFormRequest('POST', `/v1/tenant/contracts/instances/${inst.uuid}/media`, rnForm([['file', file('big.jpg', 'image/jpeg', 13 * 1024 * 1024)]])), 'VALIDATION_ERROR', 'over 12 MB rejected');
  const withMedia = await request<any>('GET', `/v1/tenant/contracts/instances/${inst.uuid}`);
  ok(withMedia.media.length === 2, 'gallery has 2 items');

  console.log('job contracts');
  const forJob = await request<any>('GET', '/v1/tenant/contracts/instances', { query: { subject_type: 'service_job', subject_uuid: jobUuid, limit: 50 } });
  ok(forJob.items.some((x: any) => x.uuid === inst.uuid) && forJob.items.every((x: any) => x.subject_uuid === jobUuid), `job contracts listed: ${forJob.items.length}`);
  if (!tpl.signature_required) {
    const fin = await request<any>('POST', `/v1/tenant/contracts/instances/${inst.uuid}/finalize`);
    ok(fin.status === 'executed', 'finalize after photos');
    await expectError(mockFormRequest('POST', `/v1/tenant/contracts/instances/${inst.uuid}/media`, rnForm([['file', file('late.jpg', 'image/jpeg')]])), 'CONFLICT', 'executed contract is locked');
  } else {
    await expectError(request('POST', `/v1/tenant/contracts/instances/${inst.uuid}/finalize`), 'CONFLICT', 'signatures still pending');
  }

  await login('personel@otopoly.com');
  await expectError(mockFormRequest('POST', '/v1/tenant/finance/accounts/import', rnForm([['file', file('x.csv', 'text/csv')], ['format', 'csv']])), 'FORBIDDEN', 'staff cannot upload imports');
  await expectError(request('PATCH', `/v1/tenant/imports/${job.uuid}/mapping`, { body: { mapping: {} } }), 'FORBIDDEN', 'staff cannot edit mappings');

  console.log(failures ? `\n${failures} failure(s)` : '\nall uploads checks passed');
  process.exit(failures ? 1 : 0);
})();
