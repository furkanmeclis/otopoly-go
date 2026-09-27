"use client";

import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { INVOICE_TONE } from "@/features/billing/components/invoices-card";
import { ORDER_TONE } from "@/features/billing/components/orders-history";
import { UsageMeter } from "@/features/billing/components/usage-meter";
import type { AdminSubscription } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useSubscriptionDetail } from "@/features/platform-billing/hooks/use-platform-billing";
import { platformBillingService } from "@/features/platform-billing/services/platform-billing.service";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

const SUB_TONE = {
  trial: "default",
  active: "success",
  grace: "warning",
  read_only: "danger",
  cancelled: "default",
} as const;

export function SubscriptionDetailSheet({
  uuid,
  canWrite,
  onEdit,
  onOpenChange,
}: {
  uuid: string | null;
  canWrite: boolean;
  onEdit: (sub: AdminSubscription) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const detail = useSubscriptionDetail(uuid);
  const d = detail.data;
  const sub = d?.subscription;

  return (
    <Sheet open={uuid !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("billing.subs.detail")}</SheetTitle>
          {sub ? (
            <SheetDescription>{sub.organization.name}</SheetDescription>
          ) : null}
        </SheetHeader>
        {!d || !sub ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          <div className="space-y-6 p-4 text-sm">
            <section className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {sub.plan.name} · {t(`billing.period.${sub.period}`)}
                </p>
                <StatusChip
                  label={t(`billing.status.${sub.status}`)}
                  tone={SUB_TONE[sub.status]}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {date(sub.starts_at, "dd.MM.yyyy", locale)} –{" "}
                {date(sub.ends_at, "dd.MM.yyyy", locale)}
                {sub.grace_ends_at
                  ? ` · ${t("billing.subs.grace_until", { date: date(sub.grace_ends_at, "dd.MM.yyyy", locale) })}`
                  : ""}
              </p>
              {sub.status === "read_only" || sub.status === "grace" ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t("billing.subs.unlock_hint")}
                </p>
              ) : null}
              {canWrite && sub.status !== "cancelled" ? (
                <Button size="sm" variant="outline" onClick={() => onEdit(sub)}>
                  {t("billing.subs.edit")}
                </Button>
              ) : null}
            </section>

            <Section title={t("billing.subs.usage")}>
              {d.meters.filter((m) => m.kind === "limit").length === 0 ? (
                <Empty />
              ) : (
                <div className="space-y-3">
                  {d.meters
                    .filter((m) => m.kind === "limit")
                    .map((m) => (
                      <UsageMeter key={m.key} meter={m} />
                    ))}
                </div>
              )}
            </Section>

            <Section title={t("billing.subs.orders")}>
              {d.orders.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y">
                  {d.orders.map((o) => (
                    <li
                      key={o.uuid}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="font-mono text-xs">
                        {o.reference_code}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {date(o.created_at, "dd.MM.yyyy", locale)}
                      </span>
                      <span className="tabular-nums">
                        {formatFinanceAmount(o.total, "TRY", locale)}
                      </span>
                      <StatusChip
                        label={t(`billing.order.status.${o.status}`)}
                        tone={ORDER_TONE[o.status]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t("billing.subs.invoices")}>
              {d.invoices.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y">
                  {d.invoices.map((inv) => (
                    <li
                      key={inv.uuid}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span className="font-mono text-xs">{inv.number}</span>
                      <span className="tabular-nums">
                        {formatFinanceAmount(inv.grand_total, "TRY", locale)}
                      </span>
                      <StatusChip
                        label={t(`billing.invoices.status.${inv.status}`)}
                        tone={INVOICE_TONE[inv.status]}
                      />
                      {inv.has_pdf ? (
                        <a
                          className="text-primary text-xs underline"
                          href={platformBillingService.invoiceFileUrl(
                            inv.uuid,
                            "pdf",
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PDF
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t("billing.subs.history")}>
              {d.history.length === 0 ? (
                <Empty />
              ) : (
                <ul className="divide-y">
                  {d.history.map((h) => (
                    <li
                      key={h.uuid}
                      className="flex items-center justify-between gap-2 py-1.5"
                    >
                      <span>
                        {h.plan.name} · {t(`billing.period.${h.period}`)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {date(h.starts_at, "dd.MM.yyyy", locale)} –{" "}
                        {date(h.ends_at, "dd.MM.yyyy", locale)}
                      </span>
                      <StatusChip
                        label={t(`billing.status.${h.status}`)}
                        tone={SUB_TONE[h.status]}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Empty() {
  const { t } = useLocale();
  return (
    <p className="text-muted-foreground text-xs">{t("billing.subs.none")}</p>
  );
}
