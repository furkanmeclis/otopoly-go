"use client";

import { useState } from "react";

import { routes } from "@/config/routes";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  JobBoardCard,
  type JobQuickAction,
} from "@/features/jobs/components/job-board-card";
import {
  BOARD_STATUSES,
  sumAmounts,
  type BoardStatus,
} from "@/features/jobs/lib/job-ui";
import type { Job } from "@/features/jobs/services/jobs.service";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const COLUMN_DOT: Record<BoardStatus, string> = {
  in_progress: "bg-amber-500",
  ready: "bg-sky-500",
  delivered: "bg-emerald-500",
};

/**
 * Three workflow columns. Each column scrolls on its own so 20+ cars keep
 * the page height fixed; on small screens one column is shown at a time.
 */
export function JobsBoard({
  slug,
  jobs,
  now,
  currency,
  canWrite,
  pendingUuid,
  onAction,
}: {
  slug: string;
  jobs: Job[];
  now: number;
  currency: string;
  canWrite: boolean;
  pendingUuid: string | null;
  onAction: (job: Job, action: JobQuickAction) => void;
}) {
  const { t, locale } = useLocale();
  const [mobileColumn, setMobileColumn] = useState<BoardStatus>("in_progress");
  const byStatus = (status: BoardStatus) =>
    jobs.filter((job) => job.status === status);

  return (
    <div>
      <div
        className="bg-muted mb-3 grid grid-cols-3 gap-1 rounded-lg p-1 lg:hidden"
        role="tablist"
      >
        {BOARD_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={mobileColumn === status}
            onClick={() => setMobileColumn(status)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              mobileColumn === status
                ? "bg-background shadow-sm"
                : "text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", COLUMN_DOT[status])} />
            {t(`jobs.status.${status}`)}
            <span className="text-muted-foreground tabular-nums">
              {byStatus(status).length}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {BOARD_STATUSES.map((status) => {
          const items = byStatus(status);
          return (
            <section
              key={status}
              aria-label={t(`jobs.status.${status}`)}
              className={cn(
                "bg-muted/40 flex min-h-0 flex-col rounded-2xl border",
                mobileColumn !== status && "hidden lg:flex",
              )}
            >
              <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn("size-2 rounded-full", COLUMN_DOT[status])}
                  />
                  <h2 className="text-sm font-semibold">
                    {t(`jobs.status.${status}`)}
                  </h2>
                  <span className="bg-background text-muted-foreground rounded-full border px-2 text-xs tabular-nums">
                    {items.length}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatFinanceAmount(sumAmounts(items), currency, locale)}
                </span>
              </header>
              <div className="flex min-h-[12rem] flex-col gap-2 p-2 lg:max-h-[calc(100svh-19rem)] lg:overflow-y-auto">
                {items.length === 0 ? (
                  <p className="text-muted-foreground m-auto px-4 py-8 text-center text-xs">
                    {t(`jobs.board.empty.${status}`)}
                  </p>
                ) : (
                  items.map((job) => (
                    <JobBoardCard
                      key={job.uuid}
                      job={job}
                      href={routes.tenant.operations.detail(slug, job.uuid)}
                      now={now}
                      canWrite={canWrite}
                      pending={pendingUuid === job.uuid}
                      onAction={onAction}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
