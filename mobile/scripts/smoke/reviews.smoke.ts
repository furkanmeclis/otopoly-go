/* Reviews smoke test: mock API rules (list filters, summary, follow-up, settings validation, test send, owner rule,
 * plan gate, delivery → scheduled request), the pure helpers and the low-score push deep link.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { quietUntil } from '@/api/mock/handlers/reviews';
import { setPlanScenario } from '@/api/mock/scenario';
import { session } from '@/api/session';
import { linkHref, resolveWebPath, toWebPath } from '@/features/notifications/deep-links';
import { hourLabel, isValidGoogleUrl, renderReviewTemplate, starsText } from '@/features/reviews/lib/review-ui';
import { reviewsService } from '@/features/reviews/services/reviews.service';
import { catalogs } from '@/locales';

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
  return me;
}

(async () => {
  console.log('helpers');
  // 22:30 Istanbul (19:30Z) is quiet → next day 09:00 (06:00Z); 16:00 passes.
  const q1 = quietUntil(new Date('2026-10-20T19:30:00Z'), 21, 9);
  ok(q1.deferred && q1.at.toISOString() === '2026-10-21T06:00:00.000Z', `quiet hours defer to 09:00 (${q1.at.toISOString()})`);
  const q2 = quietUntil(new Date('2026-10-20T13:00:00Z'), 21, 9);
  ok(!q2.deferred && q2.at.toISOString() === '2026-10-20T13:00:00.000Z', 'daytime send is not deferred');
  ok(quietUntil(new Date('2026-10-21T03:00:00Z'), 21, 9).at.toISOString() === '2026-10-21T06:00:00.000Z', 'early morning waits until 09:00 the same day');
  ok(renderReviewTemplate('Merhaba {musteri_adi}, {{isletme_adi}}: {link}', { musteri_adi: 'Ayşe', isletme_adi: 'Tech Oto', link: 'https://x/r/abc' }) === 'Merhaba Ayşe, Tech Oto: https://x/r/abc', 'template accepts {x} and {{x}}');
  ok(isValidGoogleUrl('') && isValidGoogleUrl('https://g.page/r/abc/review') && !isValidGoogleUrl('http://g.page/r/abc') && !isValidGoogleUrl('g.page/x'), 'google url rule (https only)');
  ok(starsText(4) === '★★★★☆' && starsText(null) === '—' && hourLabel(9) === '09:00', 'stars text / hour label');
  const web = toWebPath('https://otopoly.app/t/parlak-oto/reviews/0d0c3b6e-1111-4222-8333-444455556666');
  const resolved = web ? resolveWebPath(web) : null;
  ok(resolved?.kind === 'tenant' && resolved.href === '/reviews/0d0c3b6e-1111-4222-8333-444455556666', `low-score push link resolves (${resolved?.href})`);
  ok(resolveWebPath('/t/parlak-oto/reviews/settings')?.href === '/reviews/settings' && resolveWebPath('/t/parlak-oto/reviews')?.href === '/reviews', 'list / settings links resolve');
  ok(linkHref('/t/parlak-oto/reviews/abc').startsWith('/link?to='), 'push tap goes through the link resolver');
  for (const locale of ['tr', 'en'] as const) {
    const cat = catalogs[locale] as unknown as Record<string, Record<string, string>>;
    ok(cat.reviews?.['title'] && cat.mobile['reviews.filter.follow_up'] && cat.mobile['plan.module.reviews_enabled'] && cat.layout['nav_reviews'], `${locale}: review catalogs wired`);
  }

  await installMockTransport();
  console.log('owner: list / summary / follow-up');
  await login('demo@otopoly.com');
  const page = await reviewsService.list();
  ok(page.total > 5 && page.items.every((r) => r.kind === 'job'), `seeded list, tests hidden (${page.total})`);
  const summary = await reviewsService.summary(30);
  ok(summary.distribution.length === 5 && summary.distribution.map((d) => d.score).join() === '1,2,3,4,5', 'summary: five distribution rows');
  ok(summary.answered_count > 0 && summary.average_score >= 1 && summary.response_rate > 0 && summary.response_rate <= 1, `summary: avg ${summary.average_score}, rate ${summary.response_rate}`);
  ok(summary.nps === Math.round(((summary.promoters - summary.detractors) / summary.answered_count) * 100), `summary: nps from promoters / detractors (${summary.nps})`);
  const followUps = await reviewsService.list({ follow_up: 'required' });
  ok(followUps.total === summary.follow_up_required && followUps.items.every((r) => r.rating === 'low'), `follow-up filter (${followUps.total})`);
  const low = followUps.items[0];
  const high = await reviewsService.list({ rating: 'high' });
  ok(high.items.every((r) => (r.score ?? 0) >= 4), 'rating=high filter');
  ok((await reviewsService.list({ score: 5 })).items.every((r) => r.score === 5), 'score filter');
  ok((await reviewsService.list({ status: 'scheduled' })).items.every((r) => r.status === 'scheduled'), 'status filter');
  await expectError(reviewsService.list({ status: 'bogus' as never }), 'VALIDATION_ERROR', 'unknown status');
  const detail = await reviewsService.get(low.uuid);
  ok(detail.uuid === low.uuid && typeof detail.view_count === 'number', 'detail');
  const done = await reviewsService.followUp(low.uuid, 'Müşteri arandı');
  ok(done.follow_up_status === 'done' && done.follow_up_note === 'Müşteri arandı' && done.followed_up_at && done.followed_up_by_name, 'mark handled with note');
  const notAnswered = (await reviewsService.list({ status: 'sent' })).items[0];
  if (notAnswered) await expectError(reviewsService.followUp(notAnswered.uuid, ''), 'CONFLICT', 'unanswered review cannot be handled');
  await expectError(reviewsService.get('0d0c3b6e-1111-4222-8333-444455556666'), 'NOT_FOUND', 'unknown review');

  console.log('settings');
  const st = await reviewsService.settings();
  ok(st.delay_minutes === 120 && st.quiet_start_hour === 21 && st.quiet_end_hour === 9 && st.high_score_threshold === 4 && st.min_days_between === 30, 'defaults (2 h, 21–09, 4★, 30 days)');
  ok(st.template.preview.includes('Ahmet') && !st.template.preview.includes('{{'), 'template preview rendered');
  ok(st.usage.limit === 300 && st.usage.used >= 0, 'monthly usage');
  await expectError(reviewsService.saveSettings({ google_review_url: 'http://g.page/x' }), 'VALIDATION_ERROR', 'http google url refused');
  await expectError(reviewsService.saveSettings({ delay_minutes: 10 }), 'VALIDATION_ERROR', 'delay below 30 min refused');
  await expectError(reviewsService.saveSettings({ channel: 'fax' as never }), 'VALIDATION_ERROR', 'unknown channel refused');
  const saved = await reviewsService.saveSettings({ channel: 'sms', delay_minutes: 240, google_review_url: 'https://g.page/r/demo/review' });
  ok(saved.channel === 'sms' && saved.delay_minutes === 240 && saved.quiet_start_hour === 21, 'partial update keeps the rest');
  const test = await reviewsService.sendTest('+90 555 123 45 67');
  ok(test.channel === 'sms' && test.public_url.includes('/r/') && test.review.kind === 'test' && test.review.status === 'sent', 'test send');
  ok((await reviewsService.list({ include_tests: true })).items.some((r) => r.uuid === test.review.uuid), 'include_tests shows the test');
  await reviewsService.saveSettings({ channel: 'auto', delay_minutes: 120 });

  console.log('delivery schedules a request');
  const jobs = await request<any>('GET', '/v1/tenant/jobs', { query: { status: 'ready', limit: 5 } });
  const job = jobs.items.find((j: any) => j.status === 'ready');
  if (job) {
    await request<any>('POST', `/v1/tenant/jobs/${job.uuid}/deliver`);
    const scheduled = (await reviewsService.list({ status: 'scheduled', limit: 100 })).items.filter((r) => r.job_uuid === job.uuid);
    ok(scheduled.length === 1 && new Date(scheduled[0].send_at).getTime() > Date.now(), 'one scheduled request after the delay');
  } else ok(true, 'no ready job in the seed (skipped)');

  console.log('staff: read only');
  await login('personel@otopoly.com');
  ok((await reviewsService.list()).total > 0, 'staff reads the list');
  await expectError(reviewsService.followUp(followUps.items[1]?.uuid ?? low.uuid, ''), 'FORBIDDEN', 'staff cannot mark handled');
  await expectError(reviewsService.saveSettings({ enabled: false }), 'FORBIDDEN', 'staff cannot change settings');

  console.log('plan gate');
  await login('demo@otopoly.com');
  setPlanScenario('feature_disabled');
  await expectError(reviewsService.list(), 'FEATURE_DISABLED', 'reviews.enabled off → FEATURE_DISABLED');
  setPlanScenario('normal');
  const ov = await request<any>('GET', '/v1/tenant/billing/overview');
  ok(ov.meters.some((m: any) => m.key === 'reviews.monthly') && ov.meters.some((m: any) => m.key === 'reviews.enabled'), 'billing meters include reviews');

  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})();
