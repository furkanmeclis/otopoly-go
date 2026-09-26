"use client";

import {
  ArrowLeft,
  CalendarClock,
  Check,
  FilePlus2,
  ListTodo,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Phone,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/dialogs/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { routes } from "@/config/routes";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { LeadDialog } from "@/features/leads/components/lead-dialog";
import { TemperatureToggle } from "@/features/leads/components/temperature-toggle";
import {
  useLead,
  useLeadMutations,
  useLeadsAccess,
} from "@/features/leads/hooks/use-leads";
import { leadStatusTone, nextLeadStatus } from "@/features/leads/lib/lead-ui";
import type { LeadDetail, LeadEvent, LeadStatus } from "@/features/leads/types";
import { quoteStatusTone } from "@/features/quotes/lib/quote-ui";
import { LinkedTodosCard } from "@/features/todos";
import { cn } from "@/lib/utils";
import { date, datetime, relativeDatetime } from "@/lib/utils/format";
import { localToday, shiftDate } from "@/lib/utils/local-date";
import { useLocale } from "@/providers/locale-provider";

const STEPS: LeadStatus[] = ["new", "contacted", "quoted", "won"];

export function LeadDetailPage({ slug, uuid }: { slug: string; uuid: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const access = useLeadsAccess();
  const query = useLead(uuid);
  const m = useLeadMutations();
  const [editOpen, setEditOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (query.isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        title={t("leads.not_found")}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={routes.tenant.leads.root(slug)}>{t("leads.back")}</Link>
          </Button>
        }
      />
    );
  }
  const lead = query.data;
  const open = lead.status !== "won" && lead.status !== "lost";
  const next = nextLeadStatus(lead.status);
  const patch = (body: Parameters<typeof m.patch.mutate>[0]["body"]) =>
    m.patch.mutate({ uuid: lead.uuid, body });
  const newQuoteHref = `${routes.tenant.quotes.new(slug)}?lead=${lead.uuid}&customer=${lead.customer_uuid}`;

  return (
    <div className="flex w-full flex-col gap-4 pb-24 md:pb-6">
      <Link
        href={routes.tenant.leads.root(slug)}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        {t("leads.back")}
      </Link>

      <header className="bg-card flex flex-col gap-4 rounded-2xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display truncate text-xl font-semibold sm:text-2xl">
                {lead.customer_name}
              </h1>
              <StatusChip
                label={t(`leads.status.${lead.status}`)}
                tone={leadStatusTone(lead.status)}
              />
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {lead.interest || t("leads.no_interest")}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {t(`leads.source.${lead.source}`)} ·{" "}
              {datetime(lead.created_at, "dd.MM.yyyy HH:mm", locale)}
              {lead.created_by_name ? ` · ${lead.created_by_name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {access.canWrite ? (
              <TemperatureToggle
                value={lead.temperature}
                onChange={(temperature) => patch({ temperature })}
              />
            ) : null}
            {access.canWrite ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("leads.more_actions")}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil className="size-4" />
                    {t("leads.actions.edit")}
                  </DropdownMenuItem>
                  {open ? (
                    <DropdownMenuItem onSelect={() => setLostOpen(true)}>
                      <X className="size-4" />
                      {t("leads.actions.mark_lost")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onSelect={() => patch({ status: "contacted" })}
                    >
                      {t("leads.actions.reopen")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="size-4" />
                    {t("leads.actions.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        <LeadStepper
          status={lead.status}
          canWrite={access.canWrite}
          onStep={(status) => patch({ status })}
        />
        {lead.status === "lost" && lead.lost_reason ? (
          <p className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
            {t("leads.lost_reason")}: {lead.lost_reason}
          </p>
        ) : null}

        <div className="hidden flex-wrap gap-2 md:flex">
          <ActionButtons
            lead={lead}
            access={access}
            next={next}
            newQuoteHref={newQuoteHref}
            onAdvance={() => next && patch({ status: next })}
            onTodo={() => setTodoOpen(true)}
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          <Timeline lead={lead} canWrite={access.canWrite} slug={slug} />
        </div>
        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <section className="bg-card space-y-3 rounded-2xl border p-4 text-sm">
            <InfoRow label={t("leads.fields.phone")}>
              {lead.customer_phone ? (
                <a
                  href={`tel:${lead.customer_phone}`}
                  className="text-primary hover:underline"
                >
                  {lead.customer_phone}
                </a>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label={t("leads.fields.customer")}>
              <Link
                href={routes.tenant.customers.detail(slug, lead.customer_uuid)}
                className="text-primary hover:underline"
              >
                {lead.customer_name}
              </Link>
            </InfoRow>
            <InfoRow label={t("leads.fields.vehicle")}>
              {lead.vehicle_plate ? (
                <PlateBadge plate={lead.vehicle_plate} size="sm" />
              ) : (
                lead.vehicle_text || "—"
              )}
            </InfoRow>
            <InfoRow label={t("leads.fields.follow_up_date")}>
              {access.canWrite && open ? (
                <div className="flex flex-col items-end gap-1">
                  <DatePicker
                    value={lead.follow_up_date ?? ""}
                    onChange={(v) => patch({ follow_up_date: v })}
                    className={cn(
                      "h-8 w-40",
                      lead.follow_up_state === "overdue" &&
                        "border-destructive text-destructive",
                    )}
                    placeholder={t("leads.placeholders.follow_up")}
                  />
                  <div className="flex gap-1">
                    {[
                      { label: t("leads.follow.today"), days: 0 },
                      { label: t("leads.follow.tomorrow"), days: 1 },
                      { label: t("leads.follow.week"), days: 7 },
                    ].map((o) => (
                      <button
                        key={o.days}
                        type="button"
                        className="text-muted-foreground hover:text-foreground rounded border px-1.5 py-0.5 text-[11px]"
                        onClick={() =>
                          patch({
                            follow_up_date: shiftDate(localToday(), o.days),
                          })
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : lead.follow_up_date ? (
                date(lead.follow_up_date, "dd.MM.yyyy", locale)
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label={t("leads.fields.assignee")}>
              {lead.assignee?.label ?? t("leads.unassigned")}
            </InfoRow>
            {lead.notes ? (
              <div>
                <p className="text-muted-foreground mb-1 text-xs">
                  {t("leads.fields.notes")}
                </p>
                <p className="whitespace-pre-wrap">{lead.notes}</p>
              </div>
            ) : null}
          </section>

          <section className="bg-card rounded-2xl border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{t("leads.quotes")}</h2>
              {access.canQuote ? (
                <Button asChild variant="ghost" size="sm" className="h-7">
                  <Link href={newQuoteHref}>
                    <FilePlus2 className="size-4" />
                    {t("leads.actions.quote")}
                  </Link>
                </Button>
              ) : null}
            </div>
            {lead.quotes.length === 0 ? (
              <p className="text-muted-foreground px-4 py-5 text-center text-sm">
                {t("leads.no_quotes")}
              </p>
            ) : (
              <ul className="divide-y">
                {lead.quotes.map((q) => (
                  <li key={q.uuid}>
                    <Link
                      href={routes.tenant.quotes.detail(slug, q.uuid)}
                      className="hover:bg-muted/40 flex items-center justify-between gap-2 px-4 py-2.5"
                    >
                      <span className="font-mono text-xs">{q.number}</span>
                      <span className="text-sm font-medium tabular-nums">
                        {formatFinanceAmount(q.grand_total, q.currency, locale)}
                      </span>
                      <StatusChip
                        label={t(`quotes.status.${q.status}`)}
                        tone={quoteStatusTone(q.status as never)}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <LinkedTodosCard
            slug={slug}
            lead={lead.uuid}
            onAdd={access.canTodo ? () => setTodoOpen(true) : undefined}
            defaults={{
              lead: { uuid: lead.uuid, label: lead.customer_name },
              customer: { uuid: lead.customer_uuid, label: lead.customer_name },
            }}
          />
        </aside>
      </div>

      {/* Mobile action bar */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 flex gap-2 overflow-x-auto border-t p-3 backdrop-blur md:hidden">
        <ActionButtons
          lead={lead}
          access={access}
          next={next}
          newQuoteHref={newQuoteHref}
          onAdvance={() => next && patch({ status: next })}
          onTodo={() => setTodoOpen(true)}
        />
      </div>

      <LeadDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} />
      <TodoFromLeadDialog
        lead={lead}
        open={todoOpen}
        onOpenChange={setTodoOpen}
      />
      <LostDialog
        open={lostOpen}
        onOpenChange={setLostOpen}
        pending={m.patch.isPending}
        onConfirm={(reason) =>
          m.patch.mutate(
            { uuid: lead.uuid, body: { status: "lost", lost_reason: reason } },
            { onSuccess: () => setLostOpen(false) },
          )
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        title={t("leads.confirm_delete")}
        variant="destructive"
        isPending={m.remove.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          m.remove.mutate(lead.uuid, {
            onSuccess: () => router.push(routes.tenant.leads.root(slug)),
          })
        }
      />
    </div>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function ActionButtons({
  lead,
  access,
  next,
  newQuoteHref,
  onAdvance,
  onTodo,
}: {
  lead: LeadDetail;
  access: ReturnType<typeof useLeadsAccess>;
  next: LeadStatus | null;
  newQuoteHref: string;
  onAdvance: () => void;
  onTodo: () => void;
}) {
  const { t } = useLocale();
  const size = "sm" as const;
  return (
    <>
      {lead.customer_phone ? (
        <Button asChild size={size} variant="outline" className="shrink-0">
          <a href={`tel:${lead.customer_phone}`}>
            <Phone className="size-4" />
            {t("leads.actions.call")}
          </a>
        </Button>
      ) : null}
      {access.canWrite && next ? (
        <Button
          size={size}
          variant="outline"
          className="shrink-0"
          onClick={onAdvance}
        >
          <Check className="size-4" />
          {t(`leads.advance.${next}`)}
        </Button>
      ) : null}
      {access.canQuote ? (
        <Button asChild size={size} className="shrink-0">
          <Link href={newQuoteHref}>
            <FilePlus2 className="size-4" />
            {t("leads.actions.quote")}
          </Link>
        </Button>
      ) : null}
      {access.canTodo ? (
        <Button
          size={size}
          variant="outline"
          className="shrink-0"
          onClick={onTodo}
        >
          <ListTodo className="size-4" />
          {t("leads.actions.todo")}
        </Button>
      ) : null}
    </>
  );
}

function LeadStepper({
  status,
  canWrite,
  onStep,
}: {
  status: LeadStatus;
  canWrite: boolean;
  onStep: (s: LeadStatus) => void;
}) {
  const { t } = useLocale();
  const lost = status === "lost";
  const idx = STEPS.indexOf(status);
  return (
    <ol className="grid grid-cols-4 gap-1">
      {STEPS.map((step, i) => {
        const done = !lost && idx >= i;
        const current = step === status;
        return (
          <li key={step}>
            <button
              type="button"
              disabled={!canWrite || current}
              onClick={() => onStep(step)}
              className={cn(
                "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center text-[11px] font-medium transition-colors sm:text-xs",
                canWrite && !current && "hover:bg-muted",
                done ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-full rounded-full",
                  done
                    ? step === "won"
                      ? "bg-emerald-500"
                      : "bg-primary"
                    : "bg-muted",
                  lost && "bg-destructive/30",
                )}
              />
              {t(`leads.status.${step}`)}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function eventText(
  e: LeadEvent,
  t: (k: string, v?: Record<string, string | number>) => string,
) {
  const val = (kind: string, v: string) => {
    if (!v) return "—";
    if (kind === "status_changed") return t(`leads.status.${v}`);
    if (kind === "temperature_changed") return t(`leads.temperature.${v}`);
    if (kind === "source_changed") return t(`leads.source.${v}`);
    return v;
  };
  switch (e.kind) {
    case "status_changed":
    case "temperature_changed":
    case "source_changed":
    case "assignee_changed":
    case "follow_up_changed":
      return t(`leads.events.${e.kind}`, {
        from: val(e.kind, e.from_value),
        to: val(e.kind, e.to_value),
      });
    case "created":
      return t("leads.events.created", {
        source: val("source_changed", e.to_value),
      });
    default:
      return t(`leads.events.${e.kind}`, { ref: e.ref_label });
  }
}

function Timeline({
  lead,
  canWrite,
  slug,
}: {
  lead: LeadDetail;
  canWrite: boolean;
  slug: string;
}) {
  const { t, locale } = useLocale();
  const { addNote } = useLeadMutations();
  const [note, setNote] = useState("");
  const submit = () => {
    const body = note.trim();
    if (!body) return;
    addNote.mutate({ uuid: lead.uuid, body }, { onSuccess: () => setNote("") });
  };
  const refHref = (e: LeadEvent) => {
    if (!e.ref_uuid) return null;
    if (e.ref_type === "quote")
      return routes.tenant.quotes.detail(slug, e.ref_uuid);
    if (e.ref_type === "job")
      return routes.tenant.operations.detail(slug, e.ref_uuid);
    if (e.ref_type === "todo") return routes.tenant.todos.root(slug);
    return null;
  };
  return (
    <section className="bg-card rounded-2xl border">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">
        {t("leads.timeline")}
      </h2>
      {canWrite ? (
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row">
          <Textarea
            value={note}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("leads.note_placeholder")}
            className="min-h-10 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
          />
          <Button
            size="sm"
            className="self-end"
            disabled={!note.trim() || addNote.isPending}
            onClick={submit}
          >
            <MessageSquarePlus className="size-4" />
            {t("leads.actions.add_note")}
          </Button>
        </div>
      ) : null}
      <ol className="relative space-y-4 p-4 ps-8">
        <span className="bg-border absolute top-4 bottom-4 left-[1.1rem] w-px" />
        {lead.events.map((e) => {
          const href = refHref(e);
          const isNote = e.kind === "note";
          return (
            <li key={e.uuid} className="relative">
              <span
                className={cn(
                  "ring-card absolute top-1.5 -left-[1.2rem] size-2.5 rounded-full ring-4",
                  isNote
                    ? "bg-amber-500"
                    : e.kind.startsWith("quote")
                      ? "bg-primary"
                      : "bg-muted-foreground/50",
                )}
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm">
                  {isNote ? (
                    <span className="font-medium">
                      {e.actor_name || t("leads.someone")}
                    </span>
                  ) : (
                    eventText(e, t)
                  )}
                  {href && e.ref_label && !isNote ? (
                    <>
                      {" "}
                      <Link
                        href={href}
                        className="text-primary font-mono text-xs hover:underline"
                      >
                        {e.ref_label}
                      </Link>
                    </>
                  ) : null}
                </p>
                <time
                  className="text-muted-foreground text-xs"
                  title={datetime(e.created_at, "dd.MM.yyyy HH:mm", locale)}
                >
                  {relativeDatetime(e.created_at, locale)}
                </time>
              </div>
              {isNote ? (
                <p className="bg-muted/50 mt-1 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                  {e.body}
                </p>
              ) : e.body ? (
                <p className="text-muted-foreground text-xs">{e.body}</p>
              ) : null}
              {!isNote && e.actor_name ? (
                <p className="text-muted-foreground text-xs">{e.actor_name}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TodoFromLeadDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open ? (
          <TodoFromLeadBody lead={lead} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TodoFromLeadBody({
  lead,
  onClose,
}: {
  lead: LeadDetail;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const { createTodo } = useLeadMutations();
  const [title, setTitle] = useState(() =>
    t("leads.todo.default_title", { name: lead.customer_name }),
  );
  const [due, setDue] = useState(() => lead.follow_up_date ?? localToday());
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("leads.todo.title")}</DialogTitle>
        <DialogDescription>{t("leads.todo.description")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="lead-todo-title">{t("leads.todo.field_title")}</Label>
          <Input
            id="lead-todo-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("leads.todo.field_due")}</Label>
          <DatePicker value={due} onChange={setDue} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={createTodo.isPending || !title.trim()}
          onClick={() =>
            createTodo.mutate(
              {
                uuid: lead.uuid,
                body: { title: title.trim(), due_date: due || null },
              },
              { onSuccess: onClose },
            )
          }
        >
          <CalendarClock className="size-4" />
          {createTodo.isPending ? t("common.saving") : t("leads.todo.submit")}
        </Button>
      </DialogFooter>
    </>
  );
}

function LostDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open ? (
          <LostBody
            onClose={() => onOpenChange(false)}
            onConfirm={onConfirm}
            pending={pending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LostBody({
  onClose,
  onConfirm,
  pending,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState("");
  const presets = ["price", "competitor", "no_response", "not_needed"] as const;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("leads.lost.title")}</DialogTitle>
        <DialogDescription>{t("leads.lost.description")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setReason(t(`leads.lost.presets.${p}`))}
            className="text-muted-foreground hover:text-foreground rounded-full border px-2.5 py-1 text-xs"
          >
            {t(`leads.lost.presets.${p}`)}
          </button>
        ))}
      </div>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        maxLength={500}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => onConfirm(reason.trim())}
        >
          {t("leads.actions.mark_lost")}
        </Button>
      </DialogFooter>
    </>
  );
}
