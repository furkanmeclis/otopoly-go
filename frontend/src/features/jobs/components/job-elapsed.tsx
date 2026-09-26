"use client";

import { Clock } from "lucide-react";

import { minutesSince } from "@/features/jobs/lib/job-ui";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export function formatElapsed(
  minutes: number,
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  if (minutes < 60) return t("jobs.elapsed.minutes", { m: minutes });
  if (minutes >= 24 * 60) {
    const d = Math.floor(minutes / (24 * 60));
    const h = Math.floor((minutes % (24 * 60)) / 60);
    return h === 0
      ? t("jobs.elapsed.days", { d })
      : t("jobs.elapsed.days_hours", { d, h });
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? t("jobs.elapsed.hours", { h })
    : t("jobs.elapsed.hours_minutes", { h, m });
}

/** "45 dk" since start; amber once the job is waiting too long. */
export function JobElapsed({
  startedAt,
  now,
  stale,
  className,
}: {
  startedAt: string;
  now: number;
  stale?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular-nums",
        stale
          ? "font-medium text-amber-600 dark:text-amber-400"
          : "text-muted-foreground",
        className,
      )}
      title={stale ? t("jobs.board.stale_hint") : undefined}
    >
      <Clock className="size-3" />
      {formatElapsed(minutesSince(startedAt, now), t)}
    </span>
  );
}
