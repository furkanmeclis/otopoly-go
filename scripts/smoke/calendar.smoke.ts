/* Calendar smoke test: mock API rules (layers, range, events CRUD, move) through the real service, and the
 * pure feed helpers (day grouping, timeline lanes, move bodies).
 * Run: npm run test:smoke (bundled like `npm run test:mock`). */
import { request } from '@/api/client';
import { installMockTransport } from '@/api/mock';
import { setPlanScenario } from '@/api/mock/scenario';
import { session } from '@/api/session';
import { addDays, dayKey, groupByDay, itemDays, layoutDay, monthGrid, moveBody, placeItem, shiftDay } from '@/features/calendar/lib/feed';
import { calendarService } from '@/features/calendar/services/calendar.service';
import type { CalendarFeedItem } from '@/features/calendar/types';

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

const item = (over: Partial<CalendarFeedItem>): CalendarFeedItem => ({
  id: 'x',
  layer: 'events',
  kind: 'event',
  title: 'T',
  starts_at: '2026-03-02T09:00:00.000Z',
  ends_at: '2026-03-02T10:00:00.000Z',
  all_day: false,
  movable: true,
  ...over,
});

(async () => {
  console.log('helpers');
  const grid = monthGrid(new Date(2026, 2, 15));
  ok(grid.length === 42 && grid[0].getDay() === 1 && dayKey(grid[0]) <= '2026-03-01', 'month grid: 6 weeks, Monday first');
  const span = item({ id: 'span', all_day: true, start_date: '2026-03-02', end_date: '2026-03-04' });
  ok(itemDays(span).join(',') === '2026-03-02,2026-03-03,2026-03-04', 'multi-day all-day item covers each day');
  const byDay = groupByDay([span, item({ id: 'a', starts_at: new Date(2026, 2, 3, 9).toISOString(), ends_at: new Date(2026, 2, 3, 10).toISOString() })]);
  ok(byDay.get('2026-03-03')?.length === 2 && byDay.get('2026-03-03')?.[0].id === 'span', 'grouped per day, all-day first');
  const lanes = layoutDay(
    [
      item({ id: 'l1', starts_at: new Date(2026, 2, 3, 9).toISOString(), ends_at: new Date(2026, 2, 3, 11).toISOString() }),
      item({ id: 'l2', starts_at: new Date(2026, 2, 3, 10).toISOString(), ends_at: new Date(2026, 2, 3, 12).toISOString() }),
      item({ id: 'l3', starts_at: new Date(2026, 2, 3, 13).toISOString(), ends_at: new Date(2026, 2, 3, 14).toISOString() }),
    ],
    '2026-03-03',
  );
  ok(lanes[0].lanes === 2 && lanes[1].lane === 1 && lanes[2].lanes === 1 && lanes[0].top === 9 * 60, 'overlapping items split into lanes');
  const timed = item({ id: 't', starts_at: new Date(2026, 2, 3, 9).toISOString(), ends_at: new Date(2026, 2, 3, 10, 30).toISOString() });
  const moved = moveBody(timed, '2026-03-10', '14:00');
  ok(!moved.all_day && new Date(moved.ends_at!).getTime() - new Date(moved.starts_at!).getTime() === 90 * 60000, 'timed move keeps the length');
  const allDayMove = moveBody(span, '2026-03-20', null);
  ok(allDayMove.all_day && allDayMove.start_date === '2026-03-20' && allDayMove.end_date === '2026-03-22', 'all-day move keeps the span');
  ok(moveBody(item({ layer: 'leads', kind: 'lead_follow_up', all_day: true, start_date: '2026-03-02', end_date: '2026-03-02' }), '2026-03-05', '10:00').all_day, 'leads move by date only');
  ok(placeItem(span, allDayMove).start_date === '2026-03-20' && placeItem(timed, moved).starts_at === moved.starts_at, 'optimistic placement');

  console.log('meta / feed');
  await installMockTransport();
  await login('demo@otopoly.com');
  const meta = await calendarService.meta();
  ok(meta.layers.length === 10 && meta.layers.find((l) => l.key === 'events')?.movable && !meta.layers.find((l) => l.key === 'jobs')?.movable, 'owner: 10 layers, events movable, jobs not');
  ok(meta.colors.length === 10 && meta.timezone === 'Europe/Istanbul' && meta.max_range_days === 62, 'colours, time zone, max range');
  const today = new Date();
  const from = dayKey(addDays(today, -21));
  const to = dayKey(addDays(today, 21));
  const feed = await calendarService.feed({ from, to });
  const layersSeen = new Set(feed.items.map((i) => i.layer));
  ok(feed.items.length > 20, `feed has items (${feed.items.length}; layers: ${[...layersSeen].join(', ')})`);
  for (const l of ['events', 'jobs', 'todos', 'finance', 'sales']) ok(layersSeen.has(l as never), `layer ${l} has items`);
  ok(Object.entries(feed.counts).every(([l, n]) => feed.items.filter((i) => i.layer === l).length === n), 'counts match items');
  ok(feed.items.every((i) => (i.layer === 'finance' ? !i.ref_kind : Boolean(i.ref_kind && i.ref_uuid))), 'ref kind / uuid on record items');
  ok(feed.items.filter((i) => i.all_day).every((i) => i.start_date && i.end_date), 'all-day items carry dates');
  const onlyEvents = await calendarService.feed({ from, to, layers: 'events,todos' });
  ok(onlyEvents.items.every((i) => i.layer === 'events' || i.layer === 'todos') && Object.keys(onlyEvents.counts).length === 2, 'layers filter');
  await expectError(calendarService.feed({ from: to, to: from }), 'VALIDATION_ERROR', 'to before from');
  await expectError(calendarService.feed({ from, to: dayKey(addDays(today, 90)) }), 'VALIDATION_ERROR', 'range over 62 days');
  await expectError(calendarService.feed({ from, to, layers: 'events,nope' }), 'VALIDATION_ERROR', 'unknown layer');

  console.log('events');
  const day = dayKey(addDays(today, 2));
  const at = (h: number) => {
    const d = addDays(today, 2);
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  const ev = await calendarService.createEvent({ title: 'Smoke toplantı', all_day: false, starts_at: at(10), ends_at: at(11), color: 'violet', location: 'Ofis' });
  ok(ev.uuid && ev.color === 'violet' && !ev.all_day && !ev.start_date, 'timed event created');
  const allDay = await calendarService.createEvent({ title: 'Fuar', all_day: true, start_date: day, end_date: shiftDay(day, 1) });
  ok(allDay.all_day && allDay.start_date === day && allDay.end_date === shiftDay(day, 1) && allDay.color === 'blue', 'all-day event (default colour)');
  await expectError(calendarService.createEvent({ title: '  ', all_day: false, starts_at: at(10), ends_at: at(11) }), 'VALIDATION_ERROR', 'title required');
  await expectError(calendarService.createEvent({ title: 'x', all_day: false, starts_at: at(11), ends_at: at(10) }), 'VALIDATION_ERROR', 'end before start');
  await expectError(calendarService.createEvent({ title: 'x', all_day: true, start_date: day, end_date: shiftDay(day, -1) }), 'VALIDATION_ERROR', 'end_date before start_date');
  await expectError(calendarService.createEvent({ title: 'x', all_day: false, starts_at: at(10), ends_at: at(11), color: 'gold' as never }), 'VALIDATION_ERROR', 'invalid colour');
  const updated = await calendarService.updateEvent(ev.uuid, { title: 'Smoke toplantı 2', all_day: false, starts_at: at(12), ends_at: at(13), color: 'teal' });
  ok(updated.title === 'Smoke toplantı 2' && updated.color === 'teal', 'event updated');
  const inFeed = (await calendarService.feed({ from, to, layers: 'events' })).items.find((i) => i.ref_uuid === ev.uuid);
  ok(inFeed?.event?.uuid === ev.uuid && inFeed.movable && inFeed.ref_kind === 'event', 'event in feed with its record');
  const movedEv = await calendarService.move(moveBody(inFeed!, shiftDay(day, 3), '15:00'));
  ok(!movedEv.all_day && new Date(movedEv.ends_at).getTime() - new Date(movedEv.starts_at).getTime() === 3600000, 'event moved, length kept');
  ok((await calendarService.getEvent(ev.uuid)).starts_at === movedEv.starts_at, 'move persisted');
  ok((await calendarService.deleteEvent(ev.uuid)).deleted, 'event deleted');
  await expectError(calendarService.getEvent(ev.uuid), 'NOT_FOUND', 'deleted event is gone');

  console.log('move module items');
  const all = (await calendarService.feed({ from, to })).items;
  const todo = all.find((i) => i.layer === 'todos');
  if (todo) {
    const target = shiftDay(day, 1);
    const m1 = await calendarService.move(moveBody(todo, target, '16:30'));
    ok(!m1.all_day && m1.layer === 'todos' && m1.movable, 'todo moved to a time');
    const t = await request<any>('GET', `/v1/tenant/todos/${todo.ref_uuid}`);
    // The API stores the business-time (Europe/Istanbul, UTC+3) clock of the moved start.
    const ist = new Date(new Date(m1.starts_at).getTime() + 3 * 3600000).toISOString();
    ok(t.due_date === ist.slice(0, 10) && t.due_time === ist.slice(11, 16), `todo due date / time updated (${t.due_date} ${t.due_time})`);
    const m2 = await calendarService.move(moveBody(todo, target, null));
    ok(m2.all_day && m2.start_date === target, 'todo moved to all-day');
  } else ok(false, 'a todo in range');
  const lead = all.find((i) => i.layer === 'leads');
  if (lead) {
    const m = await calendarService.move(moveBody(lead, shiftDay(day, 4), null));
    const l = await request<any>('GET', `/v1/tenant/leads/${lead.ref_uuid}`);
    ok(m.all_day && l.follow_up_date === shiftDay(day, 4), 'lead follow-up moved');
  } else console.log('  - no lead follow-up in range (skipped)');
  const job = all.find((i) => i.layer === 'jobs');
  await expectError(calendarService.move({ layer: 'jobs' as never, ref_uuid: job!.ref_uuid!, all_day: true, start_date: day }), 'FORBIDDEN', 'jobs cannot be moved');
  await expectError(calendarService.move({ layer: 'events', ref_uuid: '', all_day: true, start_date: day }), 'VALIDATION_ERROR', 'ref_uuid required');

  console.log('plan / staff');
  setPlanScenario('quotes_disabled');
  const metaNoQuotes = await calendarService.meta();
  ok(!metaNoQuotes.layers.some((l) => l.key === 'quotes' || l.key === 'leads'), 'quotes module off → no quotes / leads layers');
  setPlanScenario('normal');
  await login('personel@otopoly.com');
  const staffMeta = await calendarService.meta();
  ok(staffMeta.layers.find((l) => l.key === 'events')?.movable === true, 'staff may write events (migration 000085)');

  console.log(failures ? `FAILED (${failures})` : 'ALL CALENDAR CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})();
