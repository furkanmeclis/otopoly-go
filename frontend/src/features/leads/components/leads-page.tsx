"use client";

import {
  AlarmClock,
  CalendarClock,
  ChevronRight,
  Flame,
  Megaphone,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/config/routes";
import { LeadDialog } from "@/features/leads/components/lead-dialog";
import { TemperatureToggle } from "@/features/leads/components/temperature-toggle";
import {
  useLeadMutations,
  useLeads,
  useLeadsAccess,
  useLeadSummary,
} from "@/features/leads/hooks/use-leads";
import { leadStatusTone } from "@/features/leads/lib/lead-ui";
import {
  LEAD_STATUSES,
  type Lead,
  type LeadListParams,
} from "@/features/leads/types";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { cn } from "@/lib/utils";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type StatusTab = "open" | "all" | "won" | "lost";
type Quick = "hot" | "mine" | "overdue" | "today";

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(h);
  }, [value, ms]);
  return v;
}

export function LeadsPage({ slug }: { slug: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const access = useLeadsAccess();
  const [tab, setTab] = useState<StatusTab>("open");
  const [quick, setQuick] = useState<Quick | null>(null);
  const [q, setQ] = useState("");
  const [dialogOpen, setDialogOpen] = useState(searchParams.get("new") === "1");
  const debouncedQ = useDebounced(q);
  const summary = useLeadSummary(access.canRead);

  const params = useMemo<LeadListParams>(() => {
    const p: LeadListParams = { limit: 100 };
    if (tab !== "all") p.status = tab;
    if (quick === "hot") p.temperature = "hot";
    if (quick === "mine") p.assignee = "me";
    if (quick === "overdue") p.follow_up = "overdue";
    if (quick === "today") p.follow_up = "today";
    if (quick === "overdue" || quick === "today") p.sort = "follow_up_date";
    if (debouncedQ.trim()) p.q = debouncedQ.trim();
    return p;
  }, [tab, quick, debouncedQ]);
  const list = useLeads(params, access.canRead);
  const { patch } = useLeadMutations();

  if (!access.canRead) {
    return (
      <p className="text-muted-foreground p-6 text-sm">
        {t("leads.forbidden")}
      </p>
    );
  }
  const items = list.data?.items ?? [];
  const s = summary.data;

  const quickChips: {
    key: Quick;
    label: string;
    count?: number;
    icon: typeof Flame;
  }[] = [
    {
      key: "overdue",
      label: t("leads.quick.overdue"),
      count: s?.overdue,
      icon: AlarmClock,
    },
    {
      key: "today",
      label: t("leads.quick.today"),
      count: s?.due_today,
      icon: CalendarClock,
    },
    { key: "hot", label: t("leads.quick.hot"), count: s?.hot, icon: Flame },
    {
      key: "mine",
      label: t("leads.quick.mine"),
      count: s?.mine,
      icon: UserRound,
    },
  ];

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Megaphone className="text-primary size-6" />
            {t("leads.title")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("leads.description")}
          </p>
        </div>
        {access.canWrite ? (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {t("leads.actions.create")}
          </Button>
        ) : null}
      </header>

      <dl className="bg-card grid grid-cols-3 gap-3 rounded-2xl border p-3 sm:grid-cols-5">
        {[
          { label: t("leads.summary.open"), value: s?.open },
          { label: t("leads.summary.new"), value: s?.new },
          {
            label: t("leads.summary.hot"),
            value: s?.hot,
            tone: "text-rose-600",
          },
          {
            label: t("leads.summary.overdue"),
            value: s?.overdue,
            tone: s?.overdue ? "text-destructive" : undefined,
          },
          { label: t("leads.summary.today"), value: s?.due_today },
        ].map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="text-muted-foreground truncate text-xs">
              {stat.label}
            </dt>
            <dd className={cn("text-lg font-semibold tabular-nums", stat.tone)}>
              {summary.isLoading ? (
                <Skeleton className="h-6 w-8" />
              ) : (
                (stat.value ?? 0)
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
          <TabsList>
            <TabsTrigger value="open">{t("leads.tabs.open")}</TabsTrigger>
            <TabsTrigger value="won">{t("leads.status.won")}</TabsTrigger>
            <TabsTrigger value="lost">{t("leads.status.lost")}</TabsTrigger>
            <TabsTrigger value="all">{t("leads.tabs.all")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative lg:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("leads.search")}
            className="pl-8"
          />
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {quickChips.map((chip) => {
          const Icon = chip.icon;
          const active = quick === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setQuick(active ? null : chip.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {chip.label}
              {chip.count ? (
                <span className="bg-muted rounded-full px-1.5 tabular-nums">
                  {chip.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState
          title={t("leads.error")}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void list.refetch()}
            >
              {t("common.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={q || quick ? t("leads.empty_filtered") : t("leads.empty")}
          description={q || quick ? undefined : t("leads.empty_hint")}
          action={
            access.canWrite && !q && !quick ? (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="size-4" />
                {t("leads.actions.create")}
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="bg-card divide-y overflow-hidden rounded-2xl border">
          {items.map((lead) => (
            <LeadRow
              key={lead.uuid}
              lead={lead}
              slug={slug}
              canWrite={access.canWrite}
              onTemperature={(temperature) =>
                patch.mutate({ uuid: lead.uuid, body: { temperature } })
              }
              onStatus={(status) =>
                patch.mutate({ uuid: lead.uuid, body: { status } })
              }
            />
          ))}
        </ul>
      )}
      {list.data && list.data.total > items.length ? (
        <p className="text-muted-foreground text-center text-xs">
          {t("leads.more", { shown: items.length, total: list.data.total })}
        </p>
      ) : null}

      <LeadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={(lead) =>
          router.push(routes.tenant.leads.detail(slug, lead.uuid))
        }
      />
    </div>
  );
}

function LeadRow({
  lead,
  slug,
  canWrite,
  onTemperature,
  onStatus,
}: {
  lead: Lead;
  slug: string;
  canWrite: boolean;
  onTemperature: (t: Lead["temperature"]) => void;
  onStatus: (s: Lead["status"]) => void;
}) {
  const { t, locale } = useLocale();
  const followTone =
    lead.follow_up_state === "overdue"
      ? "text-destructive font-medium"
      : lead.follow_up_state === "today"
        ? "text-amber-600 font-medium"
        : "text-muted-foreground";

  return (
    <li className="hover:bg-muted/40 relative flex flex-col gap-2 p-3 transition-colors sm:flex-row sm:items-center sm:gap-4 sm:px-4">
      <Link
        href={routes.tenant.leads.detail(slug, lead.uuid)}
        className="absolute inset-0"
        aria-label={lead.customer_name}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{lead.customer_name}</span>
          {lead.vehicle_plate ? (
            <PlateBadge plate={lead.vehicle_plate} size="sm" />
          ) : null}
          <span className="text-muted-foreground text-xs">
            {t(`leads.source.${lead.source}`)}
          </span>
        </div>
        <p className="text-muted-foreground truncate text-sm">
          {lead.interest || lead.vehicle_text || lead.customer_phone || "—"}
        </p>
      </div>
      <div className="relative z-10 flex flex-wrap items-center gap-2 sm:justify-end">
        {canWrite ? (
          <TemperatureToggle
            size="sm"
            value={lead.temperature}
            onChange={onTemperature}
          />
        ) : null}
        {canWrite ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-md focus-visible:ring-2">
                <StatusChip
                  label={t(`leads.status.${lead.status}`)}
                  tone={leadStatusTone(lead.status)}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {LEAD_STATUSES.map((st) => (
                <DropdownMenuItem
                  key={st}
                  disabled={st === lead.status}
                  onSelect={() => onStatus(st)}
                >
                  {t(`leads.status.${st}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <StatusChip
            label={t(`leads.status.${lead.status}`)}
            tone={leadStatusTone(lead.status)}
          />
        )}
        <span
          className={cn("flex items-center gap-1 text-xs sm:w-28", followTone)}
        >
          <CalendarClock className="size-3.5" />
          {lead.follow_up_date
            ? date(lead.follow_up_date, "dd MMM", locale)
            : "—"}
        </span>
        <span className="text-muted-foreground hidden w-28 truncate text-xs md:inline">
          {lead.assignee?.label ?? t("leads.unassigned")}
        </span>
        <ChevronRight className="text-muted-foreground hidden size-4 sm:block" />
      </div>
    </li>
  );
}
