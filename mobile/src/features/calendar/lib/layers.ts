import type { Href } from 'expo-router';
import {
  CalendarCheck,
  Car,
  ClipboardList,
  FileSignature,
  FileText,
  ListTodo,
  Megaphone,
  ShoppingBag,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';

import type { CalendarColor, CalendarFeedItem, CalendarLayer } from '../types';

export { COLOR_LABEL_KEYS, kindKey, statusKey } from './kinds';

type LayerDef = {
  color: CalendarColor;
  icon: LucideIcon;
  /** i18n key of the layer label (literal so check-i18n can verify it). */
  labelKey: string;
  /** Screen of the source record, or null (own events open the event sheet). */
  href: (item: CalendarFeedItem) => Href | null;
};

const ref = (item: CalendarFeedItem) => item.ref_uuid ?? '';

/** Colour, icon, label and record screen of each layer (web `features/calendar/lib/layers.ts`). */
export const LAYER_DEFS: Record<CalendarLayer, LayerDef> = {
  events: { color: 'blue', icon: CalendarCheck, labelKey: 'calendar.layers.events', href: () => null },
  jobs: { color: 'violet', icon: ClipboardList, labelKey: 'calendar.layers.jobs', href: (i) => (ref(i) ? `/jobs/${ref(i)}` : null) },
  deliveries: { color: 'teal', icon: Car, labelKey: 'calendar.layers.deliveries', href: (i) => (ref(i) ? `/jobs/${ref(i)}` : null) },
  todos: { color: 'amber', icon: ListTodo, labelKey: 'calendar.layers.todos', href: (i) => (ref(i) ? { pathname: '/todos', params: { todo: ref(i) } } : '/todos') },
  quotes: { color: 'orange', icon: FileText, labelKey: 'calendar.layers.quotes', href: (i) => (ref(i) ? `/quotes/${ref(i)}` : null) },
  leads: { color: 'pink', icon: Megaphone, labelKey: 'calendar.layers.leads', href: (i) => (ref(i) ? `/leads/${ref(i)}` : null) },
  finance: { color: 'emerald', icon: Wallet, labelKey: 'calendar.layers.finance', href: () => '/finance/transactions' },
  sales: { color: 'sky', icon: ShoppingBag, labelKey: 'calendar.layers.sales', href: (i) => (ref(i) ? `/sales/${ref(i)}` : null) },
  purchases: { color: 'rose', icon: ShoppingCart, labelKey: 'calendar.layers.purchases', href: (i) => (ref(i) ? `/purchases/${ref(i)}` : null) },
  contracts: { color: 'slate', icon: FileSignature, labelKey: 'calendar.layers.contracts', href: (i) => (ref(i) ? `/contracts/instances/${ref(i)}` : null) },
};

/** Own events use their colour; expense days read red. */
export function itemColor(item: CalendarFeedItem): CalendarColor {
  if (item.layer === 'events' && item.event?.color) return item.event.color;
  if (item.kind === 'finance_expense') return 'rose';
  return LAYER_DEFS[item.layer]?.color ?? 'slate';
}
