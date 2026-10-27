/* Widgets smoke test (docs/LIVE_WIDGETS.md): the snapshot's new parts (money, alerts, agenda) parsed from a
 * push, the 4 KB budget, the props builders (permissions, empty / locked / signed-out states, money formatting,
 * Istanbul days, deep links that exist as app routes) and the mock `finance/today` + `widget-snapshot` endpoints.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import type { MockCtx } from '@/api/mock/core';
import { installMockTransport } from '@/api/mock';
import { getDb } from '@/api/mock/db';
import { widgetSnapshotFor } from '@/api/mock/handlers/widgets';
import { session } from '@/api/session';
import type { Job } from '@/features/jobs/services/jobs.service';
import { buildTodayProps, buildTodayPropsFromSnapshot, signedOutProps, WIDGET_LINKS } from '@/features/widgets/props';
import { parseLivePush, parseWidgetSnapshot, WIDGET_PUSH_DATA_BUDGET, type WidgetSnapshot } from '@/features/widgets/push-payload';
import { createFormatters } from '@/lib/i18n/format';
import { translate } from '@/lib/i18n/translate';

declare const require: (id: 'node:fs' | 'node:path') => any;
declare const process: { cwd(): string; exit(code: number): never };
type Dirent = { name: string; isDirectory(): boolean };
const fs = require('node:fs') as { readdirSync(dir: string, opts: { withFileTypes: true }): Dirent[]; readFileSync(file: string, enc: 'utf8'): string };
const path = require('node:path') as { resolve(...p: string[]): string; join(...p: string[]): string; relative(from: string, to: string): string };

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};
async function code(p: Promise<unknown>) {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'ERR';
  }
}
async function login(email: string) {
  await session.clear('smoke');
  const t = await request<any>('POST', '/v1/auth/login', { body: { email, password: 'demo1234' }, anonymous: true });
  await session.setTokens(t, null);
  const me = await request<any>('GET', '/v1/auth/me');
  const t2 = await request<any>('POST', '/v1/auth/organization-context', { body: { organization_slug: me.organizations[0].slug } });
  await session.setTokens(t2, me.organizations[0].slug);
  return { userUuid: me.user.uuid as string, orgUuid: me.organizations[0].uuid as string };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const ORG = '11111111-2222-4333-8444-555555555555';
/** Monday 26.10.2026 15:00 in Türkiye. */
const NOW = Date.parse('2026-10-26T12:00:00Z');
const tr = (k: string, p?: Record<string, unknown>) => translate('tr', k, p as never);
const en = (k: string, p?: Record<string, unknown>) => translate('en', k, p as never);
const fmt = createFormatters('tr');
const fmtEn = createFormatters('en');

const full: WidgetSnapshot = {
  v: 1,
  date: '2026-10-26',
  at: NOW,
  counts: { in_progress: 2, ready: 1, delivered: 5 },
  paid_total: '4320.50',
  queue: [
    { id: 'r1', plate: '34 R 1', name: 'Hazır Müşteri', vehicle: 'Fiat Egea', status: 'ready', started_at: '2026-10-26T09:00:00Z' },
    { id: 'w1', plate: '34 W 1', name: 'Uzun Bekleyen', vehicle: 'Ford Focus', status: 'in_progress', started_at: '2026-10-26T07:00:00Z' },
  ],
  more: 0,
  money: {
    cur: 'TRY',
    collected: '4320.50',
    jobs: '3900.00',
    cash: '1200.00',
    card: '2620.50',
    transfer: '400.00',
    other: '100.00',
    expense: '750.00',
    net: '3570.50',
    week: ['1000.00', '0.00', '2500.00', '5000.00', '1500.00', '0.00', '4320.50'],
    accounts: [
      { n: 'Nakit Kasa', t: 'cash', b: '15200.00' },
      { n: 'Ziraat', t: 'bank', b: '-200.00' },
    ],
  },
  alerts: { stock: 3, reviews: 0, renewals: 2, unpaid: 1 },
  agenda: {
    items: [
      { k: 'todo', id: 't1', t: 'Tedarikçiyi ara', at: '2026-10-26T13:30:00Z' },
      { k: 'event', id: 'e1', t: 'Seramik randevusu', at: '2026-10-26T14:00:00Z' },
      { k: 'event', id: 'e2', t: 'Bayram', at: '' },
    ],
  },
};

(async () => {
  console.log('push payload: new snapshot parts');
  const push = parseLivePush({ data: { dataString: JSON.stringify({ kind: 'widgets.refresh', org: ORG, snapshot: full }) } });
  const snap = push?.kind === 'widgets.refresh' ? push.snapshot : null;
  ok(snap?.money?.collected === '4320.50' && snap.money.week.length === 7 && snap.money.accounts[1].b === '-200.00', 'money parsed (collections, week, balances)');
  ok(snap?.alerts?.stock === 3 && snap.alerts.unpaid === 1 && snap.alerts.reviews === 0, 'alerts parsed');
  ok(snap?.agenda?.items.length === 3 && snap.agenda.items[2].at === '', 'agenda parsed (all-day item keeps no time)');
  const staffPush = parseWidgetSnapshot({ ...full, money: undefined, paid_total: undefined, agenda: undefined, alerts: { unpaid: 2 } });
  ok(staffPush && !staffPush.money && staffPush.paid_total === '' && !staffPush.agenda && staffPush.alerts?.stock === undefined && staffPush.alerts?.unpaid === 2, 'staff snapshot: no money, only permitted alerts');
  ok(!parseWidgetSnapshot({ ...full, money: { collected: 'çok' } })?.money, 'malformed money dropped');
  ok(parseWidgetSnapshot({ ...full, alerts: { stock: -1, reviews: 'x' } })?.alerts?.stock === undefined, 'invalid alert counts dropped');
  const legacy = parseWidgetSnapshot({ v: 1, date: '2026-10-26', at: 1, counts: { in_progress: 1, ready: 0, delivered: 0 }, paid_total: '10.00', queue: [], more: 0 });
  ok(legacy && !legacy.money && !legacy.alerts, 'pre-widgets backend snapshot still parses');

  console.log('push size');
  const long = 'Ğ'.repeat(40);
  const busy: WidgetSnapshot = {
    ...full,
    queue: Array.from({ length: 5 }, (_, i) => ({ id: `6a1f5f1e-6b5c-4c8e-9a51-1f2f3a4b5c${String(i).padStart(2, '0')}`, plate: '34 ABC 123', name: long, vehicle: long, status: 'in_progress' as const, started_at: '2026-10-26T07:00:00Z' })),
    more: 20,
    agenda: { items: Array.from({ length: 3 }, (_, i) => ({ k: 'event' as const, id: `6a1f5f1e-6b5c-4c8e-9a51-1f2f3a4b5d0${i}`, t: 'Ş'.repeat(40), at: '2026-10-26T14:00:00Z' })) },
  };
  const busyData = { kind: 'widgets.refresh', org: ORG, snapshot: busy };
  ok(bytes(busyData) <= WIDGET_PUSH_DATA_BUDGET, `busy day (backend-trimmed queue) fits the budget: ${bytes(busyData)} B`);
  const typical = { kind: 'widgets.refresh', org: ORG, snapshot: { ...full, queue: Array.from({ length: 12 }, (_, i) => ({ ...full.queue[1], id: `6a1f5f1e-6b5c-4c8e-9a51-1f2f3a4b5c${String(i).padStart(2, '0')}`, name: 'Ahmet Yılmaz', vehicle: 'Renault Clio' })) } };
  ok(bytes(typical) <= WIDGET_PUSH_DATA_BUDGET, `typical day, 12 cars, every part: ${bytes(typical)} B`);
  ok(parseLivePush({ data: { body: busyData } })?.kind === 'widgets.refresh', 'busy payload parses');

  console.log('props: finance member');
  const w = buildTodayPropsFromSnapshot({ org: 'Oto Kuaför', logo: '', snapshot: full, tr, fmt, now: NOW });
  ok(w.v === 2 && w.showMoney && w.money.state === 'ok', 'money shown');
  ok(w.stats.collected === fmt.money('4320.50') && w.stats.collected.includes('4.320,50') && w.stats.jobsRevenue === fmt.money('3900.00'), `collections and jobs revenue apart (${w.stats.collected} / ${w.stats.jobsRevenue})`);
  ok(w.money.other === fmt.money(500) && w.money.moneyOut === fmt.money('750.00') && !w.money.netNegative, 'transfer + other folded, money out');
  ok(w.money.accounts.length === 2 && w.money.accounts[1].kind === 'bank' && w.money.accounts[1].balance === fmt.money(-200), 'balances (negative kept)');
  ok(w.money.week.length === 7 && w.money.week[3].ratio === 1 && w.money.week[1].ratio === 0 && w.money.week[6].today && !w.money.week[5].today, 'week bars scaled to the best day, today last');
  ok(w.money.week[6].label === 'Pt' && w.money.week[0].label === 'Sa', 'weekday labels from the Istanbul business date (Mon … Tue a week before)');
  ok(w.money.weekTotal === fmt.money(14320.5), 'week total');
  ok(w.stats.open === 3 && w.queue[0].url === 'otopoly://jobs/r1' && w.queue[1].stale, 'open count, job deep links, stale car');
  ok(w.alerts.state === 'ok' && w.alerts.items.map((i) => i.key).join() === 'unpaid,stock,renewals' && w.alerts.total === 6, 'alerts: zero counts hidden, most urgent first');
  ok(w.agenda.items[0].time === '16:30' && w.agenda.items[1].time === '17:00' && w.agenda.items[2].time === tr('mobile.widgets.all_day'), 'agenda times on the Türkiye clock, all-day label');
  ok(w.asOf === tr('mobile.widgets.as_of', { time: '15:00' }), `"as of" freshness (${w.asOf})`);
  const wEn = buildTodayPropsFromSnapshot({ org: 'X', logo: '', snapshot: full, tr: en, fmt: fmtEn, now: NOW });
  ok(wEn.labels.collected === 'Collected today' && wEn.money.week[6].label === 'Mo' && wEn.asOf.startsWith('as of'), 'English labels');

  console.log('props: permissions and states');
  const staff = buildTodayPropsFromSnapshot({ org: 'Oto Kuaför', logo: '', snapshot: staffPush!, tr, fmt, now: NOW });
  ok(!staff.showMoney && staff.money.state === 'locked' && staff.stats.collected === '' && staff.stats.jobsRevenue === '' && staff.money.week.length === 0, 'no finance read → money locked, no figures');
  ok(staff.agenda.state === 'locked' && staff.alerts.items.length === 1 && staff.alerts.items[0].key === 'unpaid', 'agenda locked, only permitted alerts');
  const quiet = buildTodayPropsFromSnapshot({ org: 'X', logo: '', snapshot: { ...full, alerts: { stock: 0, unpaid: 0 }, agenda: { items: [] }, queue: [] }, tr, fmt, now: NOW });
  ok(quiet.alerts.state === 'ok' && quiet.alerts.items.length === 0 && quiet.agenda.state === 'ok' && quiet.agenda.items.length === 0 && quiet.queue.length === 0, 'empty states: all good / nothing planned / no cars');
  const jobs = [
    { uuid: 'j1', status: 'in_progress', plate: '34 A 1', customer_name: 'A', vehicle_label: 'V', started_at: '2026-10-26T10:00:00Z' },
    { uuid: 'j2', status: 'delivered', plate: '34 A 2', customer_name: 'B', vehicle_label: 'V', started_at: '2026-10-25T20:00:00Z', delivered_at: '2026-10-25T21:30:00Z' },
  ] as unknown as Job[];
  const loading = buildTodayProps({ state: 'ok', org: 'X', logo: '', today: '2026-10-26', jobs, canFinance: true, tr, fmt, now: NOW });
  ok(loading.money.state === 'loading' && loading.alerts.state === 'loading' && !loading.showMoney, 'in-app before the snapshot: loading, not locked');
  ok(loading.stats.inProgress === 1 && loading.stats.delivered === 1, 'delivery at 00:30 Türkiye time counts for that day');
  const lockedInApp = buildTodayProps({ state: 'ok', org: 'X', logo: '', today: '2026-10-26', jobs, canFinance: false, tr, fmt, now: NOW });
  ok(lockedInApp.money.state === 'locked', 'in-app without finance read: locked');
  const inApp = buildTodayProps({ state: 'ok', org: 'X', logo: '', today: '2026-10-26', jobs, snapshot: full, canFinance: true, tr, fmt, now: NOW });
  ok(inApp.showMoney && inApp.stats.collected === fmt.money('4320.50') && inApp.stats.inProgress === 1, 'in-app: live counts + server money');
  const noAccess = buildTodayProps({ state: 'noAccess', org: 'X', logo: '', today: '2026-10-26', jobs: [], snapshot: full, canFinance: true, tr, fmt, now: NOW });
  ok(!noAccess.showMoney && noAccess.money.state === 'locked' && noAccess.alerts.items.length === 0 && noAccess.stats.collected === '', 'no jobs access: nothing leaks');
  const out = signedOutProps(w, tr, fmt, NOW);
  ok(out.state === 'signedOut' && out.org === '' && out.queue.length === 0 && !out.showMoney && out.money.accounts.length === 0 && out.agenda.items.length === 0 && out.asOf === '', 'signed out: no business data left');

  console.log('deep links');
  const appDir = path.resolve(process.cwd(), 'src/app');
  const files = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.add(
        path
          .relative(appDir, p)
          .replace(/\.tsx$/, '')
          .replace(/\([^)]+\)\//g, '')
          .replace(/(^|\/)index$/, ''),
      );
    }
  };
  walk(appDir);
  const routeOf = (url: string) => url.replace('otopoly://', '').split('?')[0];
  const exists = (route: string) => files.has(route) || [...files].some((f) => f.includes('[') && new RegExp(`^${f.replace(/\[[^\]]+\]/g, '[^/]+')}$`).test(route));
  const urls = [...Object.values(WIDGET_LINKS), ...w.alerts.items.map((i) => i.url), 'otopoly://reviews?filter=follow_up', ...w.agenda.items.map((i) => i.url), w.queue[0].url];
  const missing = urls.filter((u) => !exists(routeOf(u)));
  ok(missing.length === 0, `every widget link opens an app route${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);

  console.log('widget gallery config');
  const root = process.cwd();
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const plugin = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-widgets');
  const gallery = plugin[1].widgets as { name: string; displayName: string; description: string; ios: unknown; android: { initialLayout?: string } | null }[];
  const enStrings = JSON.parse(fs.readFileSync(path.join(root, 'assets/locales/en.json'), 'utf8')).ios['Localizable.strings'] as Record<string, string>;
  const trStrings = JSON.parse(fs.readFileSync(path.join(root, 'assets/locales/tr.json'), 'utf8')).ios['Localizable.strings'] as Record<string, string>;
  const untranslated = gallery.filter((g) => !enStrings[g.displayName] || !enStrings[g.description] || !trStrings[g.displayName] || !trStrings[g.description]).map((g) => g.name);
  ok(untranslated.length === 0, `gallery names / descriptions localized tr + en${untranslated.length ? ` (missing: ${untranslated.join(', ')})` : ''}`);
  const sources = [path.join(root, 'src/widgets'), path.join(root, 'src/widgets/android')]
    .flatMap((d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => !e.isDirectory() && e.name.endsWith('.tsx')).map((e) => fs.readFileSync(path.join(d, e.name), 'utf8')))
    .join('\n');
  const bridge = fs.readFileSync(path.join(root, 'src/features/widgets/bridge.ts'), 'utf8');
  const unbuilt = gallery.filter((g) => !sources.includes(`createWidget<TodayWidgetProps>('${g.name}'`)).map((g) => g.name);
  ok(unbuilt.length === 0, `every configured widget has a createWidget layout${unbuilt.length ? ` (missing: ${unbuilt.join(', ')})` : ''}`);
  const layouts = gallery.filter((g) => g.android?.initialLayout).map((g) => g.android!.initialLayout!.replace('./src/widgets/', '@/widgets/').replace(/\.tsx$/, ''));
  ok(layouts.length >= 5 && layouts.every((l) => bridge.includes(`require('${l}')`)), `Android widgets registered in the bridge (${layouts.length})`);

  console.log('mock API');
  await installMockTransport();
  const { orgUuid } = await login('demo@otopoly.com');
  const today = await request<any>('GET', '/v1/tenant/finance/today', { query: { days: 7 } });
  const summary = await request<any>('GET', '/v1/tenant/finance/summary', { query: { date_from: today.date, date_to: today.date } });
  ok(today.collected_total === summary.total_income && today.series.length === 7 && today.series[6].date === today.date, `finance/today matches the finance summary (${today.collected_total})`);
  const before = Number(today.collected_total);
  const acc = getDb().financeAccounts.find((a) => a.is_active)!;
  const cats = await request<any>('GET', '/v1/tenant/finance/categories', { query: { kind: 'income', limit: 5 } });
  const income = await request<any>('POST', '/v1/tenant/finance/transactions', { body: { type: 'income', account_uuid: acc.uuid, category_uuid: cats.items[0]?.uuid, amount: '100', transaction_date: today.date, payment_method: 'cash' } });
  await request('POST', '/v1/tenant/finance/transfers', { body: { from_account_uuid: acc.uuid, to_account_uuid: getDb().financeAccounts.find((a) => a.uuid !== acc.uuid)?.uuid ?? acc.uuid, amount: '50', transaction_date: today.date } }).catch(() => undefined);
  const after = await request<any>('GET', '/v1/tenant/finance/today', { query: { days: 0 } });
  ok(Number(after.collected_total) === before + 100 && after.series.length === 0, 'manual income counts, transfer does not');
  await request('POST', `/v1/tenant/finance/transactions/${income.uuid}/void`, { body: {} });
  const voided = await request<any>('GET', '/v1/tenant/finance/today');
  ok(Number(voided.collected_total) === before, 'voided income drops out');
  ok((await code(request('GET', '/v1/tenant/finance/today', { query: { date: '26.10.2026' } }))) === 'VALIDATION_ERROR', 'bad date rejected');

  const owner = await request<any>('GET', '/v1/tenant/live-activities/widget-snapshot');
  const parsedOwner = parseWidgetSnapshot(owner);
  ok(parsedOwner?.money?.collected === voided.collected_total && owner.paid_total === voided.collected_total, 'owner snapshot carries the day’s collections');
  ok(typeof parsedOwner?.alerts?.unpaid === 'number' && Array.isArray(parsedOwner?.agenda?.items), 'owner snapshot: alerts + agenda');
  const jobsOnly = widgetSnapshotFor({ orgUuid, permissions: new Set(['tenant.jobs.read']) } as unknown as MockCtx);
  ok(!jobsOnly.money && !jobsOnly.paid_total && !jobsOnly.agenda && jobsOnly.alerts?.stock === undefined && typeof jobsOnly.alerts?.unpaid === 'number', 'jobs-only member: no money, agenda or module alerts');
  const db = getDb();
  const template = db.jobs.find((j) => j._org === orgUuid)!;
  for (let i = 0; i < 30; i++) db.jobs.push({ ...template, uuid: `6a1f5f1e-6b5c-4c8e-9a51-1f2f3a4b${String(i).padStart(4, '0')}`, status: 'in_progress', customer_name: long, vehicle_label: long, started_at: new Date().toISOString() });
  const trimmed = widgetSnapshotFor({ orgUuid, permissions: new Set(['tenant.jobs.read', 'tenant.finance.read', 'tenant.calendar.read', 'tenant.todos.read']) } as unknown as MockCtx);
  const trimmedBytes = bytes({ kind: 'widgets.refresh', org: orgUuid, snapshot: trimmed });
  ok(trimmedBytes <= WIDGET_PUSH_DATA_BUDGET && trimmed.more > 0 && trimmed.queue.length + trimmed.more === trimmed.counts.in_progress + trimmed.counts.ready, `busy mock day trimmed to ${trimmedBytes} B, more=${trimmed.more}`);

  console.log(failures ? `${failures} FAILED` : 'widgets smoke OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
