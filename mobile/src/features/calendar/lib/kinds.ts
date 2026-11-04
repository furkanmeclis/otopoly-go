/** i18n keys of feed kinds, statuses and colours (pure; no React Native imports). */
import type { CalendarColor, CalendarFeedItem } from '../types';

const KIND_KEYS: Record<CalendarFeedItem['kind'], string> = {
  event: 'calendar.kinds.event',
  job_opened: 'calendar.kinds.job_opened',
  job_delivered: 'calendar.kinds.job_delivered',
  todo: 'calendar.kinds.todo',
  quote_expiry: 'calendar.kinds.quote_expiry',
  lead_follow_up: 'calendar.kinds.lead_follow_up',
  finance_income: 'calendar.kinds.finance_income',
  finance_expense: 'calendar.kinds.finance_expense',
  sale: 'calendar.kinds.sale',
  purchase: 'calendar.kinds.purchase',
  contract_executed: 'calendar.kinds.contract_executed',
};
export const kindKey = (kind: CalendarFeedItem['kind']) => KIND_KEYS[kind] ?? 'calendar.kinds.event';

const STATUS_KEYS: Record<string, string> = {
  in_progress: 'calendar.status.in_progress',
  ready: 'calendar.status.ready',
  delivered: 'calendar.status.delivered',
  cancelled: 'calendar.status.cancelled',
  paid: 'calendar.status.paid',
  unpaid: 'calendar.status.unpaid',
  open: 'calendar.status.open',
  done: 'calendar.status.done',
  draft: 'calendar.status.draft',
  sent: 'calendar.status.sent',
  viewed: 'calendar.status.viewed',
  hot: 'calendar.status.hot',
  warm: 'calendar.status.warm',
  cold: 'calendar.status.cold',
  cash: 'calendar.status.cash',
  card: 'calendar.status.card',
  cari: 'calendar.status.cari',
  executed: 'calendar.status.executed',
};
export const statusKey = (status?: string | null) => (status && STATUS_KEYS[status]) || null;

export const COLOR_LABEL_KEYS: Record<CalendarColor, string> = {
  blue: 'calendar.colors.blue',
  emerald: 'calendar.colors.emerald',
  amber: 'calendar.colors.amber',
  rose: 'calendar.colors.rose',
  violet: 'calendar.colors.violet',
  sky: 'calendar.colors.sky',
  orange: 'calendar.colors.orange',
  teal: 'calendar.colors.teal',
  pink: 'calendar.colors.pink',
  slate: 'calendar.colors.slate',
};
