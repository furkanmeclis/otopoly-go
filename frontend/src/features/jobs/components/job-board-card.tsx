"use client";

import Link from "next/link";
import { CheckCircle2, KeyRound, Loader2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { JobElapsed } from "@/features/jobs/components/job-elapsed";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import { VehicleBrandMark } from "@/features/jobs/components/vehicle-brand-mark";
import { carryOverDay, initials, isStale } from "@/features/jobs/lib/job-ui";
import type { Job } from "@/features/jobs/services/jobs.service";
import { cn } from "@/lib/utils";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export type JobQuickAction = "ready" | "deliver";

/**
 * Compact board card. The whole card links to the job; the footer button
 * advances the workflow in place (Hazır → Teslim et) or opens payment.
 */
export function JobBoardCard({
  job,
  href,
  now,
  canWrite,
  pending,
  onAction,
}: {
  job: Job;
  href: string;
  now: number;
  canWrite: boolean;
  pending: boolean;
  onAction: (job: Job, action: JobQuickAction) => void;
}) {
  const { t, locale } = useLocale();
  const stale = isStale(job, now);
  const workDay = carryOverDay(job);
  const unpaid = job.payment_status === "unpaid";

  return (
    <article
      className={cn(
        "group bg-card hover:border-primary/40 relative rounded-xl border p-3 shadow-xs transition-[border-color,box-shadow] hover:shadow-md",
        stale && "border-amber-400/60",
      )}
    >
      <Link
        href={href}
        className="focus-visible:ring-ring absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:outline-none"
        aria-label={`${job.plate} · ${job.customer_name}`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <VehicleBrandMark
            brandName={job.brand_name}
            logoUrl={job.brand_logo_url}
          />
          <PlateBadge plate={job.plate} size="sm" />
          {workDay ? (
            <span
              className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400"
              title={t("jobs.board.carry_over_hint", {
                date: datetime(job.started_at, "dd.MM.yyyy HH:mm", locale),
              })}
            >
              {t("jobs.board.carry_over_day", { n: workDay })}
            </span>
          ) : null}
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {formatFinanceAmount(job.total_amount, job.currency, locale)}
        </span>
      </div>

      <p className="mt-1.5 truncate text-sm font-medium">{job.customer_name}</p>
      {job.vehicle_label ? (
        <p className="text-muted-foreground truncate text-xs">
          {job.vehicle_label}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {job.assignee_name ? (
            <span
              title={job.assignee_name}
              className="bg-primary/10 text-primary grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold"
            >
              {initials(job.assignee_name)}
            </span>
          ) : null}
          {job.status === "delivered" ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {datetime(job.completed_at ?? job.started_at, "HH:mm", locale)}
            </span>
          ) : (
            <JobElapsed startedAt={job.started_at} now={now} stale={stale} />
          )}
        </div>
        <div className="relative z-10 shrink-0">
          {canWrite && job.status === "in_progress" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
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
              className="h-7 px-2.5 text-xs"
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
          ) : job.status === "delivered" && unpaid && canWrite ? (
            <Link
              href={href}
              className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            >
              <Wallet className="size-3" />
              {t("jobs.actions.close")}
            </Link>
          ) : job.status === "delivered" ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                unpaid
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {t(`jobs.payment.${job.payment_status}`)}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
