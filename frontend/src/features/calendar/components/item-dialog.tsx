"use client";

import { format, isSameDay, subDays } from "date-fns";
import { ArrowUpRight, Move } from "lucide-react";
import Link from "next/link";
import { createElement } from "react";

import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  COLOR_CLASSES,
  type CalendarViewItem,
} from "@/features/calendar/components/views/types";
import { itemAmount } from "@/features/calendar/lib/feed-items";
import { LAYER_DEFS, statusKey } from "@/features/calendar/lib/layers";
import type { CalendarFeedItem } from "@/features/calendar/types";
import { dateFnsLocale } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Read-only summary of a module record shown on the calendar. */
export function ItemDialog({
  slug,
  item,
  view,
  onOpenChange,
}: {
  slug: string;
  item: CalendarFeedItem | null;
  view: CalendarViewItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useLocale();
  if (!item || !view) return null;
  const def = LAYER_DEFS[item.layer];
  const href = def.href(slug, item);
  const dfLocale = dateFnsLocale(locale);
  const lastDay = subDays(view.end, 1);
  const when = view.allDay
    ? isSameDay(view.start, lastDay)
      ? `${format(view.start, "PPPP", { locale: dfLocale })} · ${t("calendar.all_day")}`
      : `${format(view.start, "PPP", { locale: dfLocale })} – ${format(lastDay, "PPP", { locale: dfLocale })}`
    : format(view.start, "PPPP · HH:mm", { locale: dfLocale });
  const sKey = statusKey(item.status);
  const amount = itemAmount(item, locale);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "flex size-6 items-center justify-center rounded-md",
                COLOR_CLASSES[view.color].chip,
              )}
            >
              {createElement(def.icon, {
                "aria-hidden": true,
                className: "size-3.5",
              })}
            </span>
            <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t(def.labelKey)}
            </span>
          </div>
          <DialogTitle className={cn(view.muted && "line-through opacity-70")}>
            {view.title}
          </DialogTitle>
          {view.subtitle ? (
            <DialogDescription>{view.subtitle}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              {t(def.labelKey)}
            </DialogDescription>
          )}
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div className="col-span-2">
            <dt className="text-muted-foreground text-xs">
              {t("calendar.detail.when")}
            </dt>
            <dd className="first-letter:uppercase">{when}</dd>
          </div>
          {amount ? (
            <div>
              <dt className="text-muted-foreground text-xs">
                {t("calendar.detail.amount")}
              </dt>
              <dd className="font-semibold tabular-nums">{amount}</dd>
            </div>
          ) : null}
          {sKey ? (
            <div>
              <dt className="text-muted-foreground text-xs">
                {t("calendar.detail.status")}
              </dt>
              <dd>
                <StatusChip
                  label={t(sKey)}
                  tone={
                    item.status === "unpaid" || item.status === "hot"
                      ? "warning"
                      : "default"
                  }
                />
              </dd>
            </div>
          ) : null}
        </dl>
        {item.movable ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Move aria-hidden className="size-3.5" />
            {t("calendar.detail.movable_hint")}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.close")}
          </Button>
          {href ? (
            <Button asChild>
              <Link href={href}>
                {t("calendar.detail.open")}
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
