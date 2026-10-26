"use client";

import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Layers,
  Plus,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/common/error-state";
import { EntityPage } from "@/components/entity";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { permissions } from "@/config/permissions";
import { routes } from "@/config/routes";
import {
  EventDialog,
  type EventDraft,
} from "@/features/calendar/components/event-dialog";
import { ItemDialog } from "@/features/calendar/components/item-dialog";
import { CalendarViews } from "@/features/calendar/components/views/calendar-views";
import {
  COLOR_CLASSES,
  visibleRange,
  type CalendarView,
  type CalendarViewItem,
} from "@/features/calendar/components/views/types";
import {
  useCalendarEvent,
  useCalendarFeed,
  useCalendarMeta,
  useCalendarMutations,
} from "@/features/calendar/hooks/use-calendar";
import { localDay, toViewItem } from "@/features/calendar/lib/feed-items";
import { LAYER_DEFS } from "@/features/calendar/lib/layers";
import {
  CALENDAR_LAYERS,
  type CalendarEvent,
  type CalendarFeedItem,
  type CalendarLayer,
  type CalendarMoveInput,
} from "@/features/calendar/types";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { dateFnsLocale, dayPickerLocale } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";

const VIEWS: CalendarView[] = ["month", "week", "day", "agenda"];
const VIEW_LABEL_KEYS: Record<CalendarView, string> = {
  month: "calendar.views.month",
  week: "calendar.views.week",
  day: "calendar.views.day",
  agenda: "calendar.views.agenda",
};
const isView = (v: unknown): v is CalendarView =>
  typeof v === "string" && (VIEWS as string[]).includes(v);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Keyboard shortcuts (shown in the help popover). */
const SHORTCUTS: { keys: string[]; labelKey: string }[] = [
  { keys: ["T"], labelKey: "calendar.shortcuts.today" },
  { keys: ["←", "→"], labelKey: "calendar.shortcuts.prev_next" },
  { keys: ["1", "2", "3", "4"], labelKey: "calendar.shortcuts.views" },
  { keys: ["N"], labelKey: "calendar.shortcuts.new_event" },
];

function shift(view: CalendarView, date: Date, dir: 1 | -1) {
  switch (view) {
    case "month":
      return addMonths(date, dir);
    case "week":
      return addWeeks(date, dir);
    case "day":
      return addDays(date, dir);
    case "agenda":
      return dir > 0 ? addDays(date, 30) : subDays(date, 30);
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest("[role=dialog],[role=menu],[role=listbox]") !== null
  );
}

export function CalendarPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const { hasPermission } = usePermission();
  const canRead = hasPermission(permissions.calendar.read);
  const canWrite = hasPermission(permissions.calendar.write);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Remembered per browser (useLocalStorage tolerates blocked storage).
  const [storedView, setView] = useLocalStorage<CalendarView>(
    "calendar:view",
    "month",
  );
  const [hidden, setHidden] = useLocalStorage<CalendarLayer[]>(
    "calendar:hidden-layers",
    [],
  );
  const view = isView(storedView) ? storedView : "month";
  const [date, setDate] = useState(() => {
    const d = searchParams.get("date");
    return d && DAY_RE.test(d) ? localDay(d) : new Date();
  });
  const [eventDialog, setEventDialog] = useState<{
    event?: CalendarEvent | null;
    draft?: EventDraft | null;
  } | null>(null);
  const [selected, setSelected] = useState<{
    item: CalendarFeedItem;
    view: CalendarViewItem;
  } | null>(null);
  const { move } = useCalendarMutations();

  // Deep links: ?date=YYYY-MM-DD&view=day and ?event=<uuid>.
  const linkedView = searchParams.get("view");
  useEffect(() => {
    if (isView(linkedView)) setView(linkedView);
  }, [linkedView, setView]);
  const linkedEventUUID = searchParams.get("event");
  const linkedEvent = useCalendarEvent(canRead ? linkedEventUUID : null);
  // Open a deep-linked event once (state adjusted during render, not in an effect).
  const [handledLink, setHandledLink] = useState<string | null>(null);
  const linked = linkedEvent.data;
  if (linked && handledLink !== linked.uuid) {
    setHandledLink(linked.uuid);
    const start =
      linked.all_day && linked.start_date
        ? localDay(linked.start_date)
        : parseISO(linked.starts_at);
    if (isValid(start)) setDate(start);
    setEventDialog({ event: linked });
  }

  const meta = useCalendarMeta(canRead);
  const available = useMemo<CalendarLayer[]>(
    () => meta.data?.layers.map((l) => l.key) ?? [...CALENDAR_LAYERS],
    [meta.data],
  );
  const hiddenSet = useMemo(
    () => new Set(Array.isArray(hidden) ? hidden : []),
    [hidden],
  );
  const layers = useMemo(
    () => available.filter((l) => !hiddenSet.has(l)),
    [available, hiddenSet],
  );

  const range = useMemo(() => visibleRange(view, date), [view, date]);
  const from = format(range.from, "yyyy-MM-dd");
  const to = format(range.to, "yyyy-MM-dd");
  const feedQuery = useCalendarFeed(from, to, layers, canRead);
  const feed = feedQuery.data;

  const { items, byId } = useMemo(() => {
    const map = new Map<string, CalendarFeedItem>();
    const out: CalendarViewItem[] = [];
    if (layers.length === 0) return { items: out, byId: map };
    for (const item of feed?.items ?? []) {
      if (!layers.includes(item.layer)) continue;
      map.set(item.id, item);
      out.push(toViewItem(item, t, locale));
    }
    return { items: out, byId: map };
  }, [feed, layers, t, locale]);

  const todayItems = useMemo(() => {
    const now = new Date();
    return items
      .filter((i) =>
        i.allDay ? i.start <= now && now < i.end : isSameDay(i.start, now),
      )
      .sort(
        (a, b) =>
          Number(b.allDay) - Number(a.allDay) ||
          a.start.getTime() - b.start.getTime(),
      );
  }, [items]);

  const title = useMemo(() => {
    switch (view) {
      case "month":
        return format(date, "LLLL yyyy", { locale: dfLocale });
      case "week": {
        const s = startOfWeek(date, { weekStartsOn: 1 });
        const e = endOfWeek(date, { weekStartsOn: 1 });
        return isSameMonth(s, e)
          ? `${format(s, "d")} – ${format(e, "d MMMM yyyy", { locale: dfLocale })}`
          : `${format(s, "d MMM", { locale: dfLocale })} – ${format(e, "d MMM yyyy", { locale: dfLocale })}`;
      }
      case "day":
        return format(date, "EEEE, d MMMM yyyy", { locale: dfLocale });
      case "agenda":
        return `${format(range.from, "d MMM", { locale: dfLocale })} – ${format(subDays(range.to, 1), "d MMM yyyy", { locale: dfLocale })}`;
    }
  }, [view, date, dfLocale, range]);

  const openNewEvent = useCallback(
    (draft: EventDraft | null) => {
      if (canWrite) setEventDialog({ draft });
    },
    [canWrite],
  );

  const onItemClick = useCallback(
    (viewItem: CalendarViewItem) => {
      const item = byId.get(viewItem.id);
      if (!item) return;
      if (item.layer === "events" && item.event && canWrite) {
        setEventDialog({ event: item.event });
      } else {
        setSelected({ item, view: viewItem });
      }
    },
    [byId, canWrite],
  );

  const onItemMove = useCallback(
    (viewItem: CalendarViewItem, start: Date, end: Date) => {
      const item = byId.get(viewItem.id);
      if (!item?.movable || !item.ref_uuid) return;
      const body: CalendarMoveInput = {
        layer: item.layer,
        ref_uuid: item.ref_uuid,
        all_day: viewItem.allDay,
      } as CalendarMoveInput;
      if (viewItem.allDay) {
        body.start_date = format(start, "yyyy-MM-dd");
        body.end_date = format(subDays(end, 1), "yyyy-MM-dd");
      } else {
        body.starts_at = start.toISOString();
        body.ends_at = end.toISOString();
      }
      move.mutate(
        { id: item.id, body },
        { onSuccess: () => toast.success(t("calendar.moved")) },
      );
    },
    [byId, move, t],
  );

  const toggleLayer = (layer: CalendarLayer, on: boolean) => {
    const next = new Set(hiddenSet);
    if (on) next.delete(layer);
    else next.add(layer);
    setHidden([...next]);
  };
  const allOn = layers.length === available.length;

  // Keyboard shortcuts (ignored while typing or with a dialog open).
  const dialogOpen = eventDialog !== null || selected !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const viewByKey: Record<string, CalendarView> = {
        "1": "month",
        "2": "week",
        "3": "day",
        "4": "agenda",
      };
      if (key === "t") setDate(new Date());
      else if (key === "arrowleft") setDate((d) => shift(view, d, -1));
      else if (key === "arrowright") setDate((d) => shift(view, d, 1));
      else if (viewByKey[key]) setView(viewByKey[key]);
      else if (key === "n" || key === "c") openNewEvent(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, view, setView, openNewEvent]);

  const layerList = (
    <div className="space-y-0.5">
      {available.map((layer) => {
        const def = LAYER_DEFS[layer];
        const Icon = def.icon;
        const on = !hiddenSet.has(layer);
        const count = feed?.counts?.[layer];
        return (
          <label
            key={layer}
            className={cn(
              "hover:bg-muted flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
              !on && "text-muted-foreground",
            )}
          >
            <Checkbox
              checked={on}
              onCheckedChange={(v) => toggleLayer(layer, v === true)}
              aria-label={t(def.labelKey)}
            />
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                COLOR_CLASSES[def.color].dot,
                !on && "opacity-40",
              )}
            />
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t(def.labelKey)}</span>
            {on && count ? (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] tabular-nums"
              >
                {count}
              </Badge>
            ) : null}
          </label>
        );
      })}
    </div>
  );

  const toggleAllButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => setHidden(allOn ? [...available] : [])}
    >
      {allOn ? t("calendar.layers.none") : t("calendar.layers.all")}
    </Button>
  );

  const showEmptyHint =
    !feedQuery.isFetching &&
    feedQuery.isSuccess &&
    items.length === 0 &&
    layers.length > 0 &&
    view !== "agenda";

  return (
    <EntityPage
      title={t("calendar.title")}
      description={t("calendar.subtitle")}
      permission={permissions.calendar.read}
      actions={
        canWrite ? (
          <Button onClick={() => openNewEvent(null)}>
            <Plus aria-hidden />
            {t("calendar.new_event")}
          </Button>
        ) : null
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="order-2 space-y-4 lg:order-1">
          <Card className="hidden gap-2 py-3 shadow-none lg:flex">
            <CardContent className="p-2">
              <Calendar
                mode="single"
                locale={dayPickerLocale(locale)}
                selected={date}
                month={date}
                onMonthChange={setDate}
                onSelect={(d) => d && setDate(d)}
                weekStartsOn={1}
                className="w-full"
              />
            </CardContent>
          </Card>

          <Card className="hidden gap-2 py-3 shadow-none lg:flex">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold">
                {t("calendar.layers.title")}
              </CardTitle>
              {toggleAllButton}
            </CardHeader>
            <CardContent className="px-2 pb-3">{layerList}</CardContent>
          </Card>

          <Card className="gap-2 py-3 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {t("calendar.today")} ·{" "}
                {format(new Date(), "d MMMM", { locale: dfLocale })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-2 pb-3">
              {todayItems.length === 0 ? (
                <p className="text-muted-foreground px-2 text-sm">
                  {t("calendar.today_empty")}
                </p>
              ) : (
                todayItems.slice(0, 8).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick(item)}
                    className="hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        COLOR_CLASSES[item.color].dot,
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate",
                          item.muted && "line-through opacity-60",
                        )}
                      >
                        {item.title}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {item.allDay
                          ? t("calendar.all_day")
                          : format(item.start, "HH:mm")}
                        {item.subtitle ? ` · ${item.subtitle}` : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
              {todayItems.length > 8 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    setDate(new Date());
                    setView("day");
                  }}
                >
                  {t("calendar.more", { count: todayItems.length - 8 })}
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </aside>

        <Card className="order-1 min-w-0 gap-0 self-start overflow-hidden py-0 shadow-none lg:order-2">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2 sm:gap-3 sm:p-3">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDate(new Date())}
              >
                {t("calendar.today")}
              </Button>
              <div className="flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("calendar.prev")}
                  onClick={() => setDate((d) => shift(view, d, -1))}
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("calendar.next")}
                  onClick={() => setDate((d) => shift(view, d, 1))}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </div>
              <h2 className="truncate text-base font-semibold first-letter:uppercase sm:text-lg">
                {title}
              </h2>
            </div>
            <div className="flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="lg:hidden"
                  >
                    <Layers aria-hidden />
                    <span className="sr-only sm:not-sr-only">
                      {t("calendar.layers.title")}
                    </span>
                    {!allOn ? (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1 text-[10px] tabular-nums"
                      >
                        {layers.length}/{available.length}
                      </Badge>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-2">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-sm font-semibold">
                      {t("calendar.layers.title")}
                    </span>
                    {toggleAllButton}
                  </div>
                  {layerList}
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="hidden md:inline-flex"
                    aria-label={t("calendar.shortcuts.title")}
                  >
                    <Keyboard aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64">
                  <p className="mb-2 text-sm font-semibold">
                    {t("calendar.shortcuts.title")}
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {SHORTCUTS.map((s) => (
                      <li
                        key={s.labelKey}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="text-muted-foreground">
                          {t(s.labelKey)}
                        </span>
                        <span className="flex gap-1">
                          {s.keys.map((k) => (
                            <kbd
                              key={k}
                              className="bg-muted rounded border px-1.5 font-mono text-[11px]"
                            >
                              {k}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={view}
                onValueChange={(next) => {
                  if (isView(next)) setView(next);
                }}
                aria-label={t("calendar.views.label")}
              >
                {VIEWS.map((v) => (
                  <ToggleGroupItem key={v} value={v} className="px-2.5">
                    {t(VIEW_LABEL_KEYS[v])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>

          {layers.length === 0 && meta.isSuccess ? (
            <div className="bg-muted/40 text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm">
              <span>{t("calendar.layers.all_hidden")}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHidden([])}
              >
                {t("calendar.layers.all")}
              </Button>
            </div>
          ) : null}
          {showEmptyHint ? (
            <div className="bg-muted/40 text-muted-foreground border-b px-3 py-2 text-sm">
              {t("calendar.empty")}
              {canWrite ? ` ${t("calendar.empty_hint")}` : ""}
            </div>
          ) : null}

          <div className="h-[calc(100dvh-15rem)] min-h-[30rem] sm:min-h-[34rem]">
            {feedQuery.isError && !feed ? (
              <ErrorState
                className="m-4"
                title={t("calendar.error.title")}
                description={t("calendar.error.description")}
                onRetry={() => void feedQuery.refetch()}
                retryLabel={t("calendar.error.retry")}
              />
            ) : (
              <CalendarViews
                items={items}
                view={view}
                date={date}
                loading={feedQuery.isFetching || meta.isLoading}
                onDateChange={setDate}
                onViewChange={setView}
                onItemClick={onItemClick}
                onSlotClick={(start, allDay) => openNewEvent({ start, allDay })}
                onItemMove={onItemMove}
              />
            )}
          </div>
        </Card>
      </div>

      <EventDialog
        open={eventDialog !== null}
        onOpenChange={(open) => {
          if (open) return;
          setEventDialog(null);
          if (linkedEventUUID)
            router.replace(routes.tenant.calendar.root(slug));
        }}
        event={eventDialog?.event}
        draft={eventDialog?.draft}
      />
      <ItemDialog
        slug={slug}
        item={selected?.item ?? null}
        view={selected?.view ?? null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </EntityPage>
  );
}
