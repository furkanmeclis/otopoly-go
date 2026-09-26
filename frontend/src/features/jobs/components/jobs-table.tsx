"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { StatusChip } from "@/components/common/status-chip";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import type { JobQuickAction } from "@/features/jobs/components/job-board-card";
import { JobElapsed } from "@/features/jobs/components/job-elapsed";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { VehicleBrandMark } from "@/features/jobs/components/vehicle-brand-mark";
import {
  carryOverDay,
  isStale,
  paymentTone,
  statusTone,
} from "@/features/jobs/lib/job-ui";
import type { Job } from "@/features/jobs/services/jobs.service";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** Dense one-row-per-car list for scanning long days. */
export function JobsTable({
  slug,
  jobs,
  now,
  canWrite,
  pendingUuid,
  onAction,
}: {
  slug: string;
  jobs: Job[];
  now: number;
  canWrite: boolean;
  pendingUuid: string | null;
  onAction: (job: Job, action: JobQuickAction) => void;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();

  return (
    <div className="bg-card overflow-x-auto rounded-2xl border">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-4 py-2.5 font-medium">{t("jobs.plate")}</th>
            <th className="px-3 py-2.5 font-medium">{t("jobs.customer")}</th>
            <th className="px-3 py-2.5 font-medium">{t("jobs.assignee")}</th>
            <th className="px-3 py-2.5 font-medium">
              {t("jobs.fields.started_at")}
            </th>
            <th className="px-3 py-2.5 font-medium">
              {t("jobs.board.status")}
            </th>
            <th className="px-3 py-2.5 text-right font-medium">
              {t("jobs.fields.total")}
            </th>
            <th className="w-36 px-4 py-2.5" aria-label={t("common.actions")} />
          </tr>
        </thead>
        <tbody className="divide-y">
          {jobs.map((job) => {
            const pending = pendingUuid === job.uuid;
            const href = routes.tenant.operations.detail(slug, job.uuid);
            return (
              <tr
                key={job.uuid}
                onClick={() => router.push(href)}
                className={cn(
                  "hover:bg-muted/40 cursor-pointer transition-colors",
                  isStale(job, now) && "bg-amber-500/5",
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <VehicleBrandMark
                      brandName={job.brand_name}
                      logoUrl={job.brand_logo_url}
                    />
                    <PlateBadge plate={job.plate} size="sm" />
                  </div>
                </td>
                <td className="max-w-[14rem] px-3 py-2.5">
                  <p className="truncate font-medium">{job.customer_name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {job.vehicle_label || job.customer_phone}
                  </p>
                </td>
                <td className="text-muted-foreground px-3 py-2.5 text-xs">
                  {job.assignee_name || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-xs tabular-nums">
                    {datetime(job.started_at, "HH:mm", locale)}
                  </p>
                  {carryOverDay(job) ? (
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {datetime(job.started_at, "dd.MM.yyyy", locale)}
                    </p>
                  ) : null}
                  {job.status === "in_progress" || job.status === "ready" ? (
                    <JobElapsed
                      startedAt={job.started_at}
                      now={now}
                      stale={isStale(job, now)}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    <StatusChip
                      label={t(`jobs.status.${job.status}`)}
                      tone={statusTone(job.status)}
                    />
                    {carryOverDay(job) ? (
                      <StatusChip
                        label={t("jobs.board.carry_over_day", {
                          n: carryOverDay(job) ?? 0,
                        })}
                        tone="default"
                      />
                    ) : null}
                    {job.status === "delivered" ? (
                      <StatusChip
                        label={t(`jobs.payment.${job.payment_status}`)}
                        tone={paymentTone(job.payment_status)}
                      />
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {formatFinanceAmount(job.total_amount, job.currency, locale)}
                </td>
                <td
                  className="px-4 py-2.5 text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canWrite && job.status === "in_progress" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={pending}
                      onClick={() => onAction(job, "ready")}
                    >
                      {pending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
                      {t("jobs.board.mark_ready")}
                    </Button>
                  ) : canWrite && job.status === "ready" ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={pending}
                      onClick={() => onAction(job, "deliver")}
                    >
                      {pending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="size-3.5" />
                      )}
                      {t("jobs.board.deliver")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
