"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/common/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type EntityStatTone = "default" | "success" | "warning" | "danger";

const toneIcon: Record<EntityStatTone, string> = {
  default: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const toneBar: Record<EntityStatTone, string> = {
  default: "[&_[data-slot=progress-indicator]]:bg-primary",
  success: "[&_[data-slot=progress-indicator]]:bg-emerald-500",
  warning: "[&_[data-slot=progress-indicator]]:bg-amber-500",
  danger: "[&_[data-slot=progress-indicator]]:bg-red-500",
};

type EntityStatTileProps = {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Secondary line under the value (comparison, last date, …). */
  hint?: ReactNode;
  tone?: EntityStatTone;
  /** 0–100; renders a thin meter under the value (e.g. stock vs minimum). */
  progress?: number;
  href?: string;
  loading?: boolean;
  className?: string;
};

/**
 * KPI tile of the 360° detail pages: icon, label, big value, hint and an
 * optional meter. Links to the related list when `href` is set.
 */
export function EntityStatTile({
  label,
  value,
  icon: Icon,
  hint,
  tone = "default",
  progress,
  href,
  loading = false,
  className,
}: EntityStatTileProps) {
  const body = (
    <CardContent className="flex h-full flex-col gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground truncate text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
        {Icon ? (
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-md",
              toneIcon[tone],
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <p className="font-display truncate text-xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
      )}
      {progress != null && !loading ? (
        <Progress
          value={Math.max(0, Math.min(100, progress))}
          className={cn("h-1.5", toneBar[tone])}
        />
      ) : null}
      {hint && !loading ? (
        <div className="text-muted-foreground mt-auto truncate text-xs">
          {hint}
        </div>
      ) : null}
    </CardContent>
  );

  if (href) {
    return (
      <Card
        className={cn(
          "hover:border-primary/40 hover:bg-muted/30 min-w-0 shadow-none transition-colors",
          className,
        )}
      >
        <Link
          href={href}
          className="block h-full rounded-[inherit] focus-visible:outline-none"
        >
          {body}
        </Link>
      </Card>
    );
  }
  return <Card className={cn("min-w-0 shadow-none", className)}>{body}</Card>;
}

/** Responsive grid for EntityStatTile rows (2 columns on phones). */
export function EntityStatGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}
