"use client";

import { Progress } from "@/components/ui/progress";
import { meterLabel, meterTone, meterUnlimited } from "@/features/billing/lib";
import type { BillingUsageMeter } from "@/features/billing/types";
import { formatQuantity } from "@/features/finance/lib/format";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type UsageMeterProps = {
  meter: BillingUsageMeter;
  /** Small inline variant for page headers. */
  compact?: boolean;
  className?: string;
};

export function UsageMeter({
  meter,
  compact = false,
  className,
}: UsageMeterProps) {
  const { t, locale } = useLocale();
  const label = meterLabel(meter, locale);
  const unlimited = meterUnlimited(meter);
  const tone = meterTone(meter);
  const limit = unlimited ? 0 : (meter.limit as number);
  const pct = unlimited
    ? 0
    : Math.min(100, Math.round((meter.used / Math.max(1, limit)) * 100));
  const tolerance = Math.round(limit * (1 + meter.tolerance_pct / 100));
  const indicator =
    tone === "over"
      ? "[&>[data-slot=progress-indicator]]:bg-rose-500"
      : tone === "warn"
        ? "[&>[data-slot=progress-indicator]]:bg-amber-500"
        : "";
  const valueClass = cn(
    "tabular-nums",
    tone === "over" && "text-rose-600 dark:text-rose-400",
    tone === "warn" && "text-amber-600 dark:text-amber-400",
  );
  const value = unlimited
    ? t("billing.usage.unlimited")
    : t("billing.usage.of", {
        used: formatQuantity(meter.used, locale),
        limit: formatQuantity(limit, locale),
      });

  return (
    <div className={cn("space-y-1", compact ? "min-w-44" : "", className)}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span
          className={cn(
            "truncate",
            compact ? "text-muted-foreground" : "font-medium",
          )}
        >
          {label}
        </span>
        <span className={valueClass}>
          {value}
          {!compact && meter.period !== "total" && meter.period !== "none"
            ? ` · ${t(`billing.usage.period.${meter.period}`)}`
            : ""}
        </span>
      </div>
      {!unlimited ? (
        <Progress
          value={pct}
          className={cn("h-1.5", indicator)}
          aria-label={label}
        />
      ) : null}
      {!compact &&
      !unlimited &&
      (meter.tolerance_pct > 0 || meter.enforcement === "soft") ? (
        <p className="text-muted-foreground text-[11px]">
          {meter.tolerance_pct > 0
            ? t("billing.usage.tolerance", {
                tolerance: formatQuantity(tolerance, locale),
              })
            : null}
          {meter.tolerance_pct > 0 && meter.enforcement === "soft"
            ? " · "
            : null}
          {meter.enforcement === "soft" ? t("billing.usage.soft") : null}
        </p>
      ) : null}
    </div>
  );
}
