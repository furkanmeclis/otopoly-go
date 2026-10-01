/* QR sign-in smoke test: mock contract (claim, single answer, single-use exchange, expiry), the scanned-code
 * parser and the copy. Run via `npm run test:smoke`. */
import { request } from '@/api/client';
import { isApiError, type ApiError } from '@/api/errors';
import { installMockTransport } from '@/api/mock';
import { expireQRSession } from '@/api/mock/handlers/qr-login';
import { session } from '@/api/session';
import { clientLabel, locationLabel, parseQRLoginCode } from '@/features/qr-login/lib';
import { qrLoginService } from '@/features/qr-login/qr-login.service';
import { catalogs } from '@/locales';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function code(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return isApiError(e) ? (e as ApiError).code : 'THROWN';
  }
}
async function login(email: string) {
  await session.clear('test');
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
}
const anon = <T>(method: string, path: string, body?: unknown) => request<T>(method, path, { body, anonymous: true, silent: true });

(async () => {
  await installMockTransport();
  const id = 'A'.repeat(43);

  console.log('parser');
  ok(parseQRLoginCode(`https://otopoly.app/login/qr/${id}`) === id, 'universal link');
  ok(parseQRLoginCode(`https://www.otopoly.app/login/qr/${id}/`) === id, 'www + trailing slash');
  ok(parseQRLoginCode(`otopoly://login/qr/${id}`) === id, 'custom scheme');
  ok(parseQRLoginCode(`https://evil.example/login/qr/${id}`) === null, 'foreign host rejected');
  ok(parseQRLoginCode(`http://otopoly.app/login/qr/${id}`) === null, 'plain http rejected');
  ok(parseQRLoginCode(`http://192.168.1.5:3000/login/qr/${id}`, ['192.168.1.5:3000']) === id, 'dev web host accepted');
  ok(parseQRLoginCode('https://otopoly.app/login/qr/short') === null, 'malformed id rejected');
  ok(parseQRLoginCode('WIFI:S:home;T:WPA;P:secret;;') === null, 'other QR codes ignored');
  ok(clientLabel({ browser: 'Chrome', browser_version: '128', os: 'Windows', device_type: 'desktop', user_agent: 'x' }, '?') === 'Chrome 128 · Windows', 'client label');
  ok(clientLabel({ browser: '', browser_version: '', os: '', device_type: 'desktop', user_agent: '' }, '?') === '?', 'unknown client');
  ok(locationLabel({ city: 'İstanbul', country_code: 'TR' }) === 'İstanbul, TR' && locationLabel(null) === null, 'location label');

  console.log('approve → state → single-use exchange');
  await login('demo@otopoly.com');
  const created = await qrLoginService.createDemo();
  ok(created.qr_url === `https://otopoly.app/login/qr/${created.session_id}` && created.realtime.channel.startsWith('qrlogin:'), 'create shape');
  const d = await qrLoginService.get(created.session_id);
  ok(d.status === 'pending' && d.client.browser === 'Chrome' && d.ip && d.location?.country_code === 'TR', 'details');
  ok((await anon<any>('POST', `/v1/auth/qr/sessions/${created.session_id}/state`, { browser_secret: created.browser_secret })).status === 'scanned', 'tab sees scanned');
  ok((await code(anon('POST', `/v1/auth/qr/sessions/${created.session_id}/state`, { browser_secret: 'wrong' }))) === 'QR_LOGIN_INVALID', 'wrong secret');
  await qrLoginService.approve(created.session_id);
  ok((await code(qrLoginService.reject(created.session_id))) === 'QR_SESSION_RESOLVED', 'second answer refused');
  const st = await anon<any>('POST', `/v1/auth/qr/sessions/${created.session_id}/state`, { browser_secret: created.browser_secret });
  ok(st.status === 'approved' && st.exchange_token, 'tab gets exchange token');
  ok((await code(anon('POST', '/v1/auth/qr/exchange', { session_id: created.session_id, browser_secret: 'x'.repeat(43), exchange_token: st.exchange_token }))) === 'QR_LOGIN_INVALID', 'exchange needs browser secret');
  const ex = await anon<any>('POST', '/v1/auth/qr/exchange', { session_id: created.session_id, browser_secret: created.browser_secret, exchange_token: st.exchange_token });
  ok(ex.access_token && ex.token_type === 'Bearer', 'exchange returns tokens');
  ok((await code(anon('POST', '/v1/auth/qr/exchange', { session_id: created.session_id, browser_secret: created.browser_secret, exchange_token: st.exchange_token }))) === 'QR_SESSION_NOT_FOUND', 'replay refused');

  console.log('claim, reject, expiry');
  const second = await qrLoginService.createDemo();
  await qrLoginService.get(second.session_id);
  await login('personel@otopoly.com');
  ok((await code(qrLoginService.get(second.session_id))) === 'QR_SESSION_CLAIMED', 'other account cannot view');
  ok((await code(qrLoginService.approve(second.session_id))) === 'QR_SESSION_CLAIMED', 'other account cannot approve');
  const third = await qrLoginService.createDemo();
  await qrLoginService.reject(third.session_id);
  ok((await anon<any>('POST', `/v1/auth/qr/sessions/${third.session_id}/state`, { browser_secret: third.browser_secret })).status === 'rejected', 'tab sees rejected');
  const fourth = await qrLoginService.createDemo();
  expireQRSession(fourth.session_id);
  ok((await code(qrLoginService.get(fourth.session_id))) === 'QR_SESSION_NOT_FOUND', 'expired');
  ok((await code(qrLoginService.get('not-an-id'))) === 'QR_SESSION_NOT_FOUND', 'malformed id 404');

  console.log('copy');
  for (const locale of ['tr', 'en'] as const) {
    const mobile = catalogs[locale].mobile as Record<string, string>;
    for (const kind of ['approved', 'rejected', 'expired', 'claimed', 'resolved', 'deactivated', 'invalid'])
      ok(mobile[`qr.result_${kind}_title`] && mobile[`qr.result_${kind}`], `${locale} qr.result_${kind}`);
    ok(mobile['qr.request_body'].includes('{{account}}') && mobile['qr.expires_in'].includes('{{seconds}}'), `${locale} placeholders`);
  }

  console.log(failures ? `${failures} FAILED` : 'QR LOGIN SMOKE OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
