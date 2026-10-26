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
} from "lucide-react";

import type { CalendarColor } from "@/features/calendar/components/views/types";
import type {
  CalendarFeedItem,
  CalendarLayer,
} from "@/features/calendar/types";
import { routes } from "@/config/routes";

type LayerDef = {
  color: CalendarColor;
  icon: LucideIcon;
  /** i18n key of the layer label (static so check-i18n can verify it). */
  labelKey: string;
  /** Record page for a feed item, or null. */
  href: (slug: string, item: CalendarFeedItem) => string | null;
};

const ref = (item: CalendarFeedItem) => item.ref_uuid ?? "";

/** Colour, icon, label and target page of each calendar layer. */
export const LAYER_DEFS: Record<CalendarLayer, LayerDef> = {
  events: {
    color: "blue",
    icon: CalendarCheck,
    labelKey: "calendar.layers.events",
    href: () => null,
  },
  jobs: {
    color: "violet",
    icon: ClipboardList,
    labelKey: "calendar.layers.jobs",
    href: (slug, item) => routes.tenant.operations.detail(slug, ref(item)),
  },
  deliveries: {
    color: "teal",
    icon: Car,
    labelKey: "calendar.layers.deliveries",
    href: (slug, item) => routes.tenant.operations.detail(slug, ref(item)),
  },
  todos: {
    color: "amber",
    icon: ListTodo,
    labelKey: "calendar.layers.todos",
    href: (slug, item) =>
      `${routes.tenant.todos.root(slug)}?todo=${encodeURIComponent(ref(item))}`,
  },
  quotes: {
    color: "orange",
    icon: FileText,
    labelKey: "calendar.layers.quotes",
    href: (slug, item) => routes.tenant.quotes.detail(slug, ref(item)),
  },
  leads: {
    color: "pink",
    icon: Megaphone,
    labelKey: "calendar.layers.leads",
    href: (slug, item) => routes.tenant.leads.detail(slug, ref(item)),
  },
  finance: {
    color: "emerald",
    icon: Wallet,
    labelKey: "calendar.layers.finance",
    href: (slug) => routes.tenant.finance.transactions.root(slug),
  },
  sales: {
    color: "sky",
    icon: ShoppingBag,
    labelKey: "calendar.layers.sales",
    href: (slug, item) => routes.tenant.sales.detail(slug, ref(item)),
  },
  purchases: {
    color: "rose",
    icon: ShoppingCart,
    labelKey: "calendar.layers.purchases",
    href: (slug, item) => routes.tenant.purchases.detail(slug, ref(item)),
  },
  contracts: {
    color: "slate",
    icon: FileSignature,
    labelKey: "calendar.layers.contracts",
    href: (slug, item) =>
      routes.tenant.contracts.instanceDetail(slug, ref(item)),
  },
};

/** Event colour for own events; expense days read red, income green. */
export function itemColor(item: CalendarFeedItem): CalendarColor {
  if (item.layer === "events" && item.event?.color) {
    return item.event.color;
  }
  if (item.kind === "finance_expense") return "rose";
  return LAYER_DEFS[item.layer].color;
}

const KIND_KEYS: Record<CalendarFeedItem["kind"], string> = {
  event: "calendar.kinds.event",
  job_opened: "calendar.kinds.job_opened",
  job_delivered: "calendar.kinds.job_delivered",
  todo: "calendar.kinds.todo",
  quote_expiry: "calendar.kinds.quote_expiry",
  lead_follow_up: "calendar.kinds.lead_follow_up",
  finance_income: "calendar.kinds.finance_income",
  finance_expense: "calendar.kinds.finance_expense",
  sale: "calendar.kinds.sale",
  purchase: "calendar.kinds.purchase",
  contract_executed: "calendar.kinds.contract_executed",
};

export function kindKey(kind: CalendarFeedItem["kind"]): string {
  return KIND_KEYS[kind] ?? "calendar.kinds.event";
}

/** Status values the detail dialog can label (others are hidden). */
const STATUS_KEYS: Record<string, string> = {
  in_progress: "calendar.status.in_progress",
  ready: "calendar.status.ready",
  delivered: "calendar.status.delivered",
  cancelled: "calendar.status.cancelled",
  paid: "calendar.status.paid",
  unpaid: "calendar.status.unpaid",
  open: "calendar.status.open",
  done: "calendar.status.done",
  draft: "calendar.status.draft",
  sent: "calendar.status.sent",
  viewed: "calendar.status.viewed",
  hot: "calendar.status.hot",
  warm: "calendar.status.warm",
  cold: "calendar.status.cold",
  cash: "calendar.status.cash",
  card: "calendar.status.card",
  cari: "calendar.status.cari",
  executed: "calendar.status.executed",
};

export function statusKey(status?: string | null): string | null {
  return (status && STATUS_KEYS[status]) || null;
}
