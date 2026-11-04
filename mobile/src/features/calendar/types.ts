import type { components } from '@/api/generated/api';

type Schemas = components['schemas'];

export type CalendarLayer = Schemas['CalendarLayer'];
export type CalendarLayerInfo = Schemas['CalendarLayerInfo'];
export type CalendarMeta = Schemas['CalendarMeta'];
export type CalendarEvent = Schemas['CalendarEvent'];
export type CalendarEventInput = Schemas['CalendarEventInput'];
export type CalendarMoveInput = Schemas['CalendarMoveInput'];
export type CalendarFeedItem = Schemas['CalendarFeedItem'];
export type CalendarFeed = Schemas['CalendarFeed'];
export type CalendarColor = Schemas['CalendarColor'];

/** Every layer in display order (mirrors the API enum). */
export const CALENDAR_LAYERS: readonly CalendarLayer[] = ['events', 'jobs', 'deliveries', 'todos', 'quotes', 'leads', 'finance', 'sales', 'purchases', 'contracts'];

/** Event colours in picker order (API `CalendarColor`). */
export const CALENDAR_COLORS: readonly CalendarColor[] = ['blue', 'emerald', 'amber', 'rose', 'violet', 'sky', 'orange', 'teal', 'pink', 'slate'];
