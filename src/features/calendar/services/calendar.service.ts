/** Calendar API (`/v1/tenant/calendar/*`; web `features/calendar/services/calendar.service.ts`). */
import { request } from '@/api/client';

import type { CalendarEvent, CalendarEventInput, CalendarFeed, CalendarFeedItem, CalendarMeta, CalendarMoveInput } from '../types';

export const calendarService = {
  meta: () => request<CalendarMeta>('GET', '/v1/tenant/calendar/meta'),
  /** `[from, to)` as YYYY-MM-DD (at most `max_range_days`); `layers` comma-separated, empty = all. */
  feed: (params: { from: string; to: string; layers?: string }) => request<CalendarFeed>('GET', '/v1/tenant/calendar/feed', { query: params }),
  move: (body: CalendarMoveInput) => request<CalendarFeedItem>('POST', '/v1/tenant/calendar/items/move', { body }),
  createEvent: (body: CalendarEventInput) => request<CalendarEvent>('POST', '/v1/tenant/calendar/events', { body }),
  getEvent: (uuid: string) => request<CalendarEvent>('GET', `/v1/tenant/calendar/events/${uuid}`),
  updateEvent: (uuid: string, body: CalendarEventInput) => request<CalendarEvent>('PUT', `/v1/tenant/calendar/events/${uuid}`, { body }),
  deleteEvent: (uuid: string) => request<{ deleted: boolean }>('DELETE', `/v1/tenant/calendar/events/${uuid}`),
};
