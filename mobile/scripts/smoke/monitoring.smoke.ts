/* Monitoring smoke test: which API failures reach the error tracker, and that endpoint tags and free
 * text never carry ids, query strings, e-mails, phone numbers or tokens. Run via `npm run test:smoke`. */
import {
  installMonitoringReporter,
  isReportableApiFailure,
  normalizeEndpoint,
  reportApiFailure,
  scrubText,
  scrubValue,
  type ApiFailure,
} from '@/lib/monitoring';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};

const sent: ApiFailure[] = [];
installMonitoringReporter({ captureError: () => {}, captureApiFailure: (f) => sent.push(f), setUser: () => {} });

ok(isReportableApiFailure(500, 'INTERNAL'), '5xx is reported');
ok(isReportableApiFailure(0, 'NETWORK_ERROR') && isReportableApiFailure(0, 'TIMEOUT'), 'network / timeout are reported');
for (const [status, code] of [
  [400, 'VALIDATION_ERROR'],
  [401, 'UNAUTHENTICATED'],
  [403, 'LIMIT_REACHED'],
  [404, 'NOT_FOUND'],
  [429, 'RATE_LIMITED'],
  [0, 'ABORTED'],
] as const) {
  ok(!isReportableApiFailure(status, code), `${status} ${code} is not reported`);
}
reportApiFailure({ method: 'GET', path: '/v1/jobs', status: 422, code: 'VALIDATION_ERROR' });
reportApiFailure({ method: 'GET', path: '/v1/jobs', status: 502, code: 'INTERNAL' });
ok(sent.length === 1 && sent[0].status === 502, 'only the 502 reached the reporter');

ok(normalizeEndpoint('/v1/jobs/8f1c2b9e-0d7a-4f43-9a51-7c1d2e3f4a5b/photos') === '/v1/jobs/:id/photos', 'uuid segment → :id');
ok(normalizeEndpoint('/v1/customers/12345?q=ali@example.com') === '/v1/customers/:id', 'numeric id and query dropped');
ok(normalizeEndpoint('https://api.otopoly.app/v1/qr/AbC123xyz') === '/v1/qr/:id', 'origin and token dropped');
ok(normalizeEndpoint('/v1/auth/refresh') === '/v1/auth/refresh', 'plain route kept');

const text = scrubText('Failed for ali.veli@example.com +90 555 123 45 67 Bearer abc.def.ghi at https://api.otopoly.app/v1/customers/42?phone=05551234567');
ok(!/example\.com|555 123|05551234567|abc\.def|\?phone/.test(text), `free text scrubbed: ${text}`);

const value = scrubValue({ email: 'a@b.co', nested: { phone: '05551234567', note: 'call 0555 123 4567' }, status: 500, name: 'Ali' }) as Record<string, unknown>;
const flat = JSON.stringify(value);
ok(!/a@b\.co|05551234567|0555 123 4567|Ali/.test(flat) && value.status === 500, `values scrubbed: ${flat}`);

console.log(failures ? `${failures} MONITORING CHECK(S) FAILED` : 'all monitoring checks passed');
process.exit(failures ? 1 : 0);
