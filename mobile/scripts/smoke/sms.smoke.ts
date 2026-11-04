/* SMS channels smoke test (Kanallar): provider accounts, masked hints, one active provider, connection check,
 * test SMS, segment estimate, and the channel choice of the daily summary / vehicle alerts / contract OTP.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { session } from '@/api/session';
import { dailySummaryService } from '@/features/messaging/services/daily-summary.service';
import { smsService } from '@/features/messaging/services/sms.service';
import { vehicleAlertsService } from '@/features/messaging/services/vehicle-alerts.service';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function expectError(p: Promise<unknown>, code: string, msg: string) {
  try {
    await p;
    ok(false, `${msg} (expected ${code})`);
  } catch (e) {
    ok((e as { code?: string }).code === code, `${msg} → ${(e as { code?: string }).code}`);
  }
}
async function login(email: string) {
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
}

(async () => {
  await installMockTransport();
  await login('demo@otopoly.com');

  console.log('overview');
  const ov = await smsService.overview();
  const netgsm = ov.providers.find((p) => p.provider === 'netgsm')!;
  const twilio = ov.providers.find((p) => p.provider === 'twilio')!;
  ok(ov.active_provider === 'netgsm' && netgsm.account?.is_active && twilio.account === null, 'Netgsm connected + active, Twilio not connected');
  ok(netgsm.sender_kind === 'msgheader' && twilio.sender_kind === 'from' && netgsm.fields.map((f) => f.key).join() === 'usercode,password', 'fields + sender kinds');
  ok(netgsm.account!.credential_hints.password?.startsWith('••••••') && !JSON.stringify(ov).includes('demo-api-sifre'), 'only masked hints leave the API');

  console.log('estimate');
  const e0 = await smsService.estimate('');
  ok(e0.provider === 'netgsm' && e0.segments.segments === 0 && e0.segments.remaining === 155, 'empty body (active provider)');
  const e1 = await smsService.estimate('Aracınız hazır, teşekkürler', 'netgsm');
  ok(e1.segments.encoding === 'turkish' && e1.segments.segments === 1, 'Turkish characters on Netgsm');
  const e2 = await smsService.estimate('Aracınız hazır', 'twilio');
  ok(e2.segments.encoding === 'ucs2' && e2.segments.per_segment === 70, 'Turkish characters on Twilio → UCS-2');
  const e3 = await smsService.estimate('a'.repeat(161), 'twilio');
  ok(e3.segments.encoding === 'gsm7' && e3.segments.segments === 2 && e3.segments.per_segment === 153 && e3.segments.remaining === 145, 'long GSM-7 text splits into 153-char parts');
  const e4 = await smsService.estimate('Merhaba 👋', 'netgsm');
  ok(e4.segments.encoding === 'ucs2', 'emoji → UCS-2');

  console.log('connect / edit');
  await expectError(smsService.save('twilio', { credentials: { account_sid: 'AC123' }, sender: '+15005550006' }), 'VALIDATION_ERROR', 'missing auth_token');
  await expectError(smsService.save('twilio', { credentials: { account_sid: 'AC1', auth_token: 'x', bogus: 'y' }, sender: 'X' }), 'VALIDATION_ERROR', 'unknown credential');
  await expectError(smsService.save('twilio', { credentials: { account_sid: 'AC1', auth_token: 'x' }, sender: '' }), 'VALIDATION_ERROR', 'sender required');
  const tw = await smsService.save('twilio', { credentials: { account_sid: 'AC0123456789abcdef', auth_token: 'token-secret-99' }, sender: '+15005550006', activate: true });
  ok(tw.is_active && tw.status === 'unchecked' && tw.credential_hints.auth_token === '••••••99' && tw.credential_hints.account_sid === 'AC••••ef', 'Twilio connected + activated, masked hints');
  const ov2 = await smsService.overview();
  ok(ov2.active_provider === 'twilio' && !ov2.providers.find((p) => p.provider === 'netgsm')!.account!.is_active, 'only one active provider');
  const kept = await smsService.save('netgsm', { credentials: { usercode: '', password: '' }, sender: 'TECHOTO2' });
  ok(kept.sender === 'TECHOTO2' && kept.credential_hints.usercode === netgsm.account!.credential_hints.usercode && !kept.is_active, 'empty credentials keep the stored ones (stays passive)');
  await expectError(request('PATCH', '/v1/tenant/messaging/sms/netgsm', { body: {} }), 'VALIDATION_ERROR', 'is_active required');
  const on = await smsService.setActive('netgsm', true);
  ok(on.is_active && (await smsService.overview()).active_provider === 'netgsm', 'activate Netgsm switches Twilio off');
  await expectError(smsService.overview().then(() => request('PUT', '/v1/tenant/messaging/sms/nope', { body: {} })), 'NOT_FOUND', 'unknown provider');

  console.log('check / test SMS');
  const t1 = await smsService.test('netgsm');
  ok(t1.ok && t1.balance && t1.senders?.length && t1.account.status === 'connected' && t1.account.last_checked_at, 'connection check ok (balance, headers)');
  await smsService.save('netgsm', { credentials: { password: 'wrong' } });
  const t2 = await smsService.test('netgsm');
  ok(!t2.ok && t2.error_code === 'sms_auth_failed' && t2.account.status === 'error' && t2.account.last_error, 'bad credentials → classified failure, status error');
  const failed = await smsService.sendTest('netgsm', { phone: '0532 123 45 67' });
  ok(failed.status === 'failed' && failed.error_code === 'sms_auth_failed', 'test SMS with bad credentials fails');
  await smsService.save('netgsm', { credentials: { password: 'fixed-password' } });
  await expectError(smsService.sendTest('netgsm', { phone: '123' }), 'VALIDATION_ERROR', 'invalid phone');
  const sent = await smsService.sendTest('netgsm', { phone: '0532 123 45 67', body: 'Test ğüşıöç' });
  ok(sent.status === 'sent' && sent.recipient === '+90532•••4567' && sent.segments.encoding === 'turkish' && sent.provider_message_id, 'test SMS sent (masked recipient, segments)');

  console.log('channel choice');
  const ds = await dailySummaryService.get();
  ok(ds.channel === 'whatsapp' && ds.sms_available === true, 'daily summary: whatsapp by default, SMS available');
  const ds2 = await dailySummaryService.update({ enabled: true, send_time: ds.send_time, recipient_user_uuids: ds.recipient_user_uuids, channel: 'sms' });
  ok(ds2.channel === 'sms', 'daily summary channel → sms');
  const ds3 = await dailySummaryService.update({ enabled: true, send_time: '21:00', recipient_user_uuids: ds.recipient_user_uuids });
  ok(ds3.channel === 'sms' && ds3.send_time === '21:00', 'omitted channel keeps the saved one');
  await expectError(request('PUT', '/v1/tenant/daily-summary', { body: { enabled: true, send_time: '21:00', recipient_user_uuids: ds.recipient_user_uuids, channel: 'fax' } }), 'VALIDATION_ERROR', 'invalid channel');
  ok((await dailySummaryService.sendTest()).sent >= 1, 'daily summary test over SMS');
  const va = await vehicleAlertsService.get();
  const va2 = await vehicleAlertsService.update({ enabled: true, events: va.events, service_uuids: [], recipient_user_uuids: va.recipient_user_uuids, batch_minutes: 0, channel: 'sms' });
  ok(va2.channel === 'sms' && va2.sms_available, 'vehicle alerts channel → sms');
  const vt = await vehicleAlertsService.sendTest();
  ok(typeof vt.sms === 'number' && vt.whatsapp === 0, `vehicle alerts test counts SMS (${vt.sms})`);
  const sim = await request<any>('POST', '/v1/tenant/messaging/simulate', { body: { mode: 'job_lifecycle', channel: 'sms', phone: '05321234567', vars: {} } });
  ok(sim.items.length === 4 && sim.items.every((i: any) => i.channel === 'sms' && i.status === 'sent'), 'simulate over SMS');
  const rule = await request<any>('PATCH', '/v1/tenant/messaging/rules/job.ready/sms', { body: { enabled: true } });
  ok(rule.enabled && rule.channel === 'sms', 'SMS notification rule can be switched on');

  // Contract OTP over SMS (a pending contract with an OTP signer from the demo seed).
  const instances = await request<any>('GET', '/v1/tenant/contracts/instances', { query: { limit: 50, offset: 0 } });
  const pending = instances.items.find((i: any) => i.status === 'pending');
  const detail = pending ? await request<any>('GET', `/v1/tenant/contracts/instances/${pending.uuid}`) : null;
  const signer = detail?.signers.find((s: any) => s.otp_required && s.status === 'pending');
  if (detail && signer) {
    const otp = await request<any>('POST', `/v1/tenant/contracts/instances/${detail.uuid}/signers/${signer.uuid}/otp`, { body: { phone: '05321234567', channel: 'sms' } });
    ok(otp.channel === 'sms', 'contract OTP sent over SMS');
  } else console.log('  - no pending OTP signer in the demo seed (skipped)');

  console.log('read-only / disconnect');
  await login('personel@otopoly.com');
  ok((await smsService.overview()).providers.length === 2, 'staff can read the channels');
  await expectError(smsService.save('netgsm', { sender: 'X' }), 'FORBIDDEN', 'staff cannot change them');
  await expectError(smsService.test('netgsm'), 'FORBIDDEN', 'staff cannot run the check');
  await login('demo@otopoly.com');
  ok((await smsService.disconnect('netgsm')).success && (await smsService.disconnect('twilio')).success, 'both providers disconnected');
  const empty = await smsService.overview();
  ok(empty.active_provider === '' && empty.providers.every((p) => p.account === null), 'no accounts left');
  await expectError(smsService.disconnect('twilio'), 'NOT_FOUND', 'disconnect again → 404');
  ok((await dailySummaryService.get()).sms_available === false, 'SMS no longer available to the daily summary');
  await expectError(dailySummaryService.sendTest(), 'SMS_NOT_CONFIGURED', 'SMS daily summary test without a provider');

  console.log(failures ? `FAILED (${failures})` : 'ALL SMS CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
