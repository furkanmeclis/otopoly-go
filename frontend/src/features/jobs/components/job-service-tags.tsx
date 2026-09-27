"use client";

import { serviceSwatch } from "@/features/catalog/lib/service-colors";
import type { JobServiceTag } from "@/features/jobs/services/jobs.service";
import { cn } from "@/lib/utils";

/** Coloured service badges (one per service line). */
export function JobServiceTags({
  services,
  max = 4,
  className,
}: {
  services?: JobServiceTag[];
  max?: number;
  className?: string;
}) {
  if (!services?.length) return null;
  const shown = services.slice(0, max);
  const rest = services.length - shown.length;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((s, i) => (
        <span
          key={`${s.uuid ?? s.name}-${i}`}
          title={s.name}
          className={cn(
            "max-w-[10rem] truncate rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium",
            serviceSwatch(s.color, s.name).badge,
          )}
        >
          {s.name}
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-muted-foreground text-[11px]">+{rest}</span>
      ) : null}
    </div>
  );
}

/** Top stripe split into the job's service colours. */
export function JobServiceStripe({
  services,
  className,
}: {
  services?: JobServiceTag[];
  className?: string;
}) {
  if (!services?.length) return null;
  // One segment per distinct colour, in line order.
  const seen = new Set<string>();
  const segments = services
    .map((s) => serviceSwatch(s.color, s.name).stripe)
    .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  return (
    <div aria-hidden className={cn("flex h-1.5 overflow-hidden", className)}>
      {segments.map((c) => (
        <span key={c} className={cn("flex-1", c)} />
      ))}
    </div>
  );
}
