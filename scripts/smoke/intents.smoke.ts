/* Siri / Shortcuts (App Intents) smoke test: invocation routing and permission gates, the pending-queue
 * policy, plate lookups, the catalogs shared with Siri and the donation rules, plus the copy and the
 * Swift ↔ JS contract (dispatch names, catalog kinds, donation registrations). Pure TS, no native module.
 * Run via `npm run test:smoke`. */
import { P, type Gate } from '@/features/auth/permissions';
import {
  CATALOG_KINDS,
  CUSTOMER_CATALOG_LIMIT,
  DONATABLE,
  DONATION_INTERVAL_MS,
  availableShortcuts,
  customerCatalog,
  shouldDonate,
  todayFigures,
  todayRecord,
} from '@/features/intents/catalog';
import { INTENT_GATES, INTENT_NAMES, INVOCATION_TTL_MS, decideIntent, normalizePlate, pickInvocation, plateHref } from '@/features/intents/routing';
import { catalogs } from '@/locales';

// Node built-ins without @types/node (same approach as ai-stream.smoke.ts).
declare const require: (id: 'node:fs' | 'node:path') => any;
declare const process: { cwd(): string; exit(code: number): never };
const fs = require('node:fs') as { readdirSync(dir: string): string[]; readFileSync(file: string, enc: 'utf8'): string };
const path = require('node:path') as { resolve(...p: string[]): string; join(...p: string[]): string };

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};

const canWith = (perms: string[], owner = false) => (gate: Gate | undefined) => {
  if (!gate) return true;
  if (gate.perm && !perms.includes(gate.perm)) return false;
  return !gate.owner || owner;
};
const everything = canWith(Object.values(P));
// Staff without AI / calendar / customer access (a washer who only sees the board).
const boardOnly = canWith([P.jobsRead]);
const inv = (name: string, params: Record<string, unknown> = {}, id = 'inv-1') => ({ id, name, params });

console.log('routing');
ok(decideIntent(inv('readyJobs'), everything).kind === 'route' && (decideIntent(inv('readyJobs'), everything) as { href: string }).href === '/operations?filter=ready', 'ready cars → operations board, ready column');
ok((decideIntent(inv('calendarToday'), everything) as { href: string }).href === '/calendar', 'calendar → calendar');
ok((decideIntent(inv('qrLogin'), boardOnly) as { href: string }).href === '/qr-scan', 'QR sign-in needs no tenant permission');
ok((decideIntent(inv('openCustomer', { customerId: 'c-123' }), everything) as { href: string }).href === '/customers/c-123', 'open customer → customer page');
ok(decideIntent(inv('openCustomer', { customerId: '../../etc' }), everything).kind === 'invalid', 'customer id is validated (no path injection)');
ok(decideIntent(inv('openCustomer', {}), everything).kind === 'invalid', 'missing customer id is invalid');
ok((decideIntent(inv('newJob'), everything) as { href: string }).href === '/jobs/new', 'new job without plate → empty form');
const withPlate = decideIntent(inv('newJob', { plate: ' 34 abc-12 ' }), everything);
ok(withPlate.kind === 'plate' && withPlate.plate === '34ABC12' && withPlate.target === 'newJob', 'new job with plate → plate lookup (normalized)');
ok(decideIntent(inv('newJob', { plate: '34ABC12' }), canWith([P.jobsWrite])).kind === 'route', 'without customers.read the plate is ignored, form still opens');
const search = decideIntent(inv('searchPlate', { plate: '06 xy 99' }), everything);
ok(search.kind === 'plate' && search.target === 'search', 'plate search → lookup');
ok((decideIntent(inv('searchPlate', { plate: '  ' }), everything) as { href: string }).href === '/customers', 'blank plate → customers list');
const ask = decideIntent(inv('askAssistant', { prompt: 'Bu hafta ciro ne kadar?' }, 'abc'), everything) as { href: string };
ok(ask.href === `/assistant/new?prompt=${encodeURIComponent('Bu hafta ciro ne kadar?')}&n=abc`, 'assistant gets the question and a one-shot nonce');
ok(((decideIntent(inv('askAssistant', { prompt: 'x'.repeat(5000) }), everything) as { href: string }).href.length ?? 0) < 2200, 'very long questions are capped');
ok(decideIntent(inv('dropTables'), everything).kind === 'invalid', 'unknown intent name is invalid');
ok(decideIntent(inv('newJob', { plate: 1234 }), everything).kind === 'route', 'non-string params are ignored');

console.log('permissions');
for (const name of INTENT_NAMES) ok(Object.hasOwn(INTENT_GATES, name), `${name} has a gate entry`);
ok(decideIntent(inv('newJob'), boardOnly).kind === 'denied', 'new job needs jobs.write');
ok(decideIntent(inv('askAssistant', { prompt: 'x' }), boardOnly).kind === 'denied', 'assistant needs ai.use');
ok(decideIntent(inv('calendarToday'), boardOnly).kind === 'denied', 'calendar needs calendar.read');
ok(decideIntent(inv('openCustomer', { customerId: 'c1' }), boardOnly).kind === 'denied', 'customers need customers.read');
ok(decideIntent(inv('readyJobs'), boardOnly).kind === 'route', 'board-only staff can open ready cars');
ok(availableShortcuts(boardOnly).join() === 'todaySummary,readyJobs,qrLogin', 'settings card lists only usable shortcuts');
ok(availableShortcuts(everything).length === 8, 'owner sees all 8 shortcuts');

console.log('pending queue');
const now = 1_800_000_000_000;
const q = [
  { id: 'old', createdAt: now - INVOCATION_TTL_MS - 1 },
  { id: 'a', createdAt: now - 5_000 },
  { id: 'b', createdAt: now - 1_000 },
  { id: 'future', createdAt: now + 10 * 60_000 },
];
const picked = pickInvocation(q, now);
ok(picked.run?.id === 'b', 'only the newest fresh invocation navigates');
ok(picked.discard.map((i) => i.id).join() === 'old,a,future', 'stale, older and clock-skewed ones are dropped');
ok(pickInvocation(q, now, new Set(['b'])).run?.id === 'a', 'already handled ids are skipped (at-least-once delivery)');
ok(pickInvocation([], now).run === null, 'empty queue is fine');

console.log('plate lookups');
ok(normalizePlate('34 abc-12') === '34ABC12', 'plates normalized like the backend');
ok(plateHref('search', '34ABC12', { customers: [{ uuid: 'c1' }] }) === '/customers/c1', 'single match opens the customer');
ok(plateHref('search', '34ABC12', { customers: [{ uuid: 'c1' }, { uuid: 'c2' }] }) === '/customers?q=34ABC12', 'several matches → searched list');
ok(plateHref('search', '34ABC12', null) === '/customers?q=34ABC12', 'lookup failure → searched list');
ok(plateHref('newJob', '34ABC12', { customers: [{ uuid: 'c1' }], vehicles: [{ uuid: 'v9', plate: '34 ABC 12' }] }) === '/jobs/new?customer=c1&vehicle=v9', 'new job picks customer and vehicle');
ok(plateHref('newJob', '34ABC12', { customers: [{ uuid: 'c1' }], vehicles: [{ uuid: 'v9', plate: '06 X 1' }] }) === '/jobs/new?customer=c1', 'vehicle not matched → customer only');
ok(plateHref('newJob', '34ABC12', { customers: [] }) === '/jobs/new', 'no match → empty form');

console.log('catalogs');
const jobs = [
  { customer_uuid: 'c1', customer_name: 'Ahmet Yılmaz', plate: '34 ABC 12', started_at: '2026-10-20T09:00:00Z' },
  { customer_uuid: 'c2', customer_name: 'Ayşe Kaya', plate: '06 XY 99', started_at: '2026-10-25T09:00:00Z' },
  { customer_uuid: 'c1', customer_name: 'Ahmet Yılmaz', plate: '34ABC12', started_at: '2026-10-22T09:00:00Z' },
  { customer_uuid: 'c1', customer_name: 'Ahmet Yılmaz', plate: '34 DEF 1', started_at: '2026-10-23T09:00:00Z' },
  { customer_uuid: '', customer_name: 'Orphan', plate: 'X', started_at: null },
];
const cat = customerCatalog(jobs);
ok(cat.length === 2 && cat[0].id === 'c1', 'frequent customers first, orphans skipped');
ok(cat[0].subtitle === '34 ABC 12 · 34 DEF 1', 'plates deduplicated (spacing-insensitive) as subtitle');
ok(cat[0].synonyms?.includes('34ABC12') && cat[0].synonyms?.includes('34 ABC 12'), 'plates resolvable spoken or compact');
ok(cat.every((e) => Object.keys(e).every((k) => ['id', 'title', 'subtitle', 'synonyms'].includes(k))), 'no phone / e-mail / balance in the customer catalog');
const many = Array.from({ length: 120 }, (_, i) => ({ customer_uuid: `c${i}`, customer_name: `Müşteri ${i}`, plate: `P${i}`, started_at: null }));
ok(customerCatalog(many).length === CUSTOMER_CATALOG_LIMIT, `catalog capped at ${CUSTOMER_CATALOG_LIMIT}`);
ok(new Set(customerCatalog(many).map((e) => e.id)).size === CUSTOMER_CATALOG_LIMIT, 'catalog ids unique');
const figures = todayFigures(
  [
    { status: 'in_progress' },
    { status: 'in_progress' },
    { status: 'ready' },
    { status: 'delivered', delivered_at: '2026-10-26T10:00:00Z' },
    { status: 'delivered', delivered_at: '2026-10-20T10:00:00Z' },
    { status: 'cancelled' },
  ],
  '2026-10-25',
  '₺1.250,00',
);
ok(figures.inProgress === 2 && figures.ready === 1 && figures.delivered === 1, 'today figures match the dashboard rules');
const rec = todayRecord({ org: 'Parlak Oto', date: '2026-10-26', updated: '14:05', figures });
ok(rec.id === 'today' && rec.title === 'Parlak Oto' && rec.metadata?.state === 'ok' && rec.metadata?.inProgress === '2' && rec.metadata?.collected === '₺1.250,00', 'today record carries the figures as strings');
ok(Object.values(rec.metadata ?? {}).every((v) => typeof v === 'string'), 'metadata is string-only (native record type)');
const noAccess = todayRecord({ org: ' ', date: '2026-10-26', updated: '14:05', figures: null });
ok(noAccess.title === 'Otopoly' && noAccess.metadata?.state === 'noAccess' && !('collected' in (noAccess.metadata ?? {})), 'no jobs.read → no figures, title never blank');

console.log('donations');
const published = new Set(['c1']);
const base = { can: everything, now, publishedCustomers: published };
ok(shouldDonate({ name: 'newJob' }, base), 'first donation goes through');
ok(!shouldDonate({ name: 'newJob' }, { ...base, lastAt: now - 1000 }), 'throttled within the interval');
ok(shouldDonate({ name: 'newJob' }, { ...base, lastAt: now - DONATION_INTERVAL_MS }), 'allowed again after the interval');
ok(!shouldDonate({ name: 'newJob' }, { ...base, can: boardOnly }), 'never donates an intent the member cannot use');
ok(shouldDonate({ name: 'openCustomer', customerId: 'c1' }, base), 'customer donation when Siri can resolve it');
ok(!shouldDonate({ name: 'openCustomer', customerId: 'c2' }, base), 'no donation for a customer outside the catalog');
ok(!shouldDonate({ name: 'openCustomer' }, base), 'customer donation needs an id');
ok(!shouldDonate({ name: 'readyJobs', customerId: 'c1' }, base), 'parameterless intents carry no ids');
ok(!shouldDonate({ name: 'searchPlate' as never }, base) && !shouldDonate({ name: 'askAssistant' as never }, base), 'free text (plates, questions) is never donated');

console.log('swift contract');
const dir = path.resolve(process.cwd(), 'app-intents');
const swift = fs.readdirSync(dir).filter((f: string) => f.endsWith('.swift')).map((f: string) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
for (const name of INTENT_NAMES) ok(swift.includes(`dispatch(name: "${name}"`), `Swift dispatches ${name}`);
for (const name of DONATABLE) ok(swift.includes(`register("${name}"`), `Swift registers donation ${name}`);
ok(swift.includes(`"${CATALOG_KINDS.today}"`) && swift.includes(`"${CATALOG_KINDS.customers}"`), 'catalog kinds match OtopolyCatalog');
ok((swift.match(/AppShortcut\(\s*intent:/g) ?? []).length <= 10, 'at most 10 App Shortcuts');
const phrases = [...swift.matchAll(/"([^"\n]*\\\(\.applicationName\)[^"\n]*)"/g)].map((m) => m[1]);
const shortcutsCatalog = JSON.parse(fs.readFileSync(path.join(dir, 'AppShortcuts.xcstrings'), 'utf8')).strings as Record<string, { localizations: { tr: { stringUnit: { value: string } } } }>;
for (const phrase of phrases) {
  const key = phrase.replace(/\\\(\.applicationName\)/g, '${applicationName}').replace(/\\\(\\\.\$(\w+)\)/g, '${$1}');
  const trValue = shortcutsCatalog[key]?.localizations.tr.stringUnit.value;
  ok(trValue?.includes('${applicationName}'), `Turkish phrase for "${key}"`);
}
const localizable = JSON.parse(fs.readFileSync(path.join(dir, 'Localizable.xcstrings'), 'utf8')).strings as Record<string, unknown>;
for (const m of swift.matchAll(/(?:title|shortTitle|requestValueDialog): "([^"\\]+)"|IntentDescription\("([^"\\]+)"\)|LocalizedStringResource = "([^"\\]+)"|TypeDisplayRepresentation = "([^"\\]+)"/g)) {
  const key = m[1] ?? m[2] ?? m[3] ?? m[4];
  ok(Object.hasOwn(localizable, key), `Turkish string for "${key}"`);
}

console.log('copy');
const trMobile = catalogs.tr.mobile as Record<string, string>;
const enMobile = catalogs.en.mobile as Record<string, string>;
for (const name of availableShortcuts(everything)) {
  for (const part of ['title', 'phrase', 'hint']) ok(trMobile[`intents.shortcut.${name}.${part}`] && enMobile[`intents.shortcut.${name}.${part}`], `copy ${name}.${part} (tr + en)`);
}
ok(trMobile['intents.plate_not_found'].includes('{{plate}}') && enMobile['intents.plate_not_found'].includes('{{plate}}'), 'plate placeholder in both languages');

console.log(failures ? `${failures} FAILED` : 'INTENTS SMOKE OK');
process.exit(failures ? 1 : 0);
