/* Business-day smoke test: "today", day keys, month starts and wall-clock conversions follow
 * Europe/Istanbul whatever zone the process (phone) runs in. The owner's report: a record saved at
 * 01:38 on 27.10.2026 in Türkiye (26.10.2026 22:38 UTC) landed on the previous day.
 * Run: npm run test:smoke (bundled like `npm run test:mock`). Node applies a changed process.env.TZ at
 * once, so every check runs under several phone time zones. */
import { istanbulDay } from '@/api/mock/core';
import { localDateOf, shiftDate } from '@/features/jobs/lib/job-ui';
import { itemStart, moveBody } from '@/features/calendar/lib/feed';
import type { CalendarFeedItem } from '@/features/calendar/types';
import {
  businessDateTimeISO,
  businessDayOf,
  businessDayStartISO,
  businessMonthStart,
  businessTimeOf,
  businessToday,
  businessWallClock,
  daysBetween,
  shiftDay,
  wallClockToISO,
} from '@/lib/business-date';
import { createFormatters } from '@/lib/i18n/format';

let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) failures++;
  console.log(cond ? '  ✓' : '  ✗', msg);
};

function run(zone: string) {
  process.env.TZ = zone;
  console.log(`business-date (TZ=${zone})`);
  const lateNight = new Date('2026-10-26T22:38:00Z');

  ok(businessToday(lateNight) === '2026-10-27', 'today at 22:38Z is 27.10');
  ok(businessDayOf('2026-10-26T22:38:00Z') === '2026-10-27', 'day of a UTC timestamp is the Istanbul day');
  ok(businessDayOf('2026-10-27') === '2026-10-27', 'a bare day stays');
  ok(localDateOf('2026-10-26T22:38:00Z') === '2026-10-27', 'jobs localDateOf uses the Istanbul day');
  ok(istanbulDay('2026-10-26T22:38:00Z') === '2026-10-27', 'mock istanbulDay mirrors the backend');
  ok(businessMonthStart(new Date('2026-10-31T22:30:00Z')) === '2026-11-01', 'month start after 21:00Z on the last day is next month');
  ok(shiftDay('2026-12-31', 1) === '2027-01-01' && shiftDate('2026-10-27', -30) === '2026-09-27', 'day arithmetic');
  ok(daysBetween('2026-10-01', '2026-10-27') === 26, 'days between');
  ok(businessDayStartISO('2026-10-27') === '2026-10-26T21:00:00.000Z', 'Istanbul midnight of 27.10 is 26.10 21:00Z');
  ok(businessDateTimeISO('2026-10-27', '01:38') === lateNight.toISOString(), '27.10 01:38 Istanbul is 26.10 22:38Z');
  ok(businessTimeOf(lateNight) === '01:38', 'wall-clock time');
  const wall = businessWallClock(lateNight);
  ok(wall.getFullYear() === 2026 && wall.getMonth() === 9 && wall.getDate() === 27 && wall.getHours() === 1 && wall.getMinutes() === 38, 'wall clock fields');
  ok(wallClockToISO(wall) === lateNight.toISOString(), 'wall clock round trip');

  // Formatters show API timestamps on the Türkiye clock and bare days as that day.
  const fmt = createFormatters('en');
  ok(fmt.date('2026-10-26T22:38:00Z', 'medium') === 'Oct 27, 2026', `fmt.date(22:38Z) → ${fmt.date('2026-10-26T22:38:00Z', 'medium')}`);
  ok(fmt.date('2026-10-27', 'medium') === 'Oct 27, 2026', 'fmt.date(day) keeps the day');
  ok(/01:38/.test(fmt.time('2026-10-26T22:38:00Z')), `fmt.time(22:38Z) → ${fmt.time('2026-10-26T22:38:00Z')}`);

  // Calendar: a timed item at 22:38Z sits on 27.10 01:38; moving it to 27.10 09:00 sends 06:00Z.
  const ev = {
    id: 'x', layer: 'events', kind: 'event', title: 'T', all_day: false, ref_uuid: 'r',
    starts_at: '2026-10-26T22:38:00Z', ends_at: '2026-10-26T23:38:00Z',
  } as unknown as CalendarFeedItem;
  const start = itemStart(ev);
  ok(start.getDate() === 27 && start.getHours() === 1, 'calendar item starts on the Istanbul wall clock');
  const body = moveBody(ev, '2026-10-27', '09:00');
  ok(body.starts_at === '2026-10-27T06:00:00.000Z' && body.ends_at === '2026-10-27T07:00:00.000Z', `move body → ${body.starts_at} – ${body.ends_at}`);
}

for (const zone of ['UTC', 'Europe/Istanbul', 'America/Los_Angeles', 'Pacific/Kiritimati']) run(zone);

if (failures) {
  console.log(`FAILED: ${failures}`);
  process.exit(1);
}
console.log('business-date smoke passed');
