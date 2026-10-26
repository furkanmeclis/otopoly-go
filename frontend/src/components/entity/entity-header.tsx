"use client";

import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/common/card";
import { cn } from "@/lib/utils";

type EntityHeaderProps = {
  title: ReactNode;
  /** Status chips, badges, etc. next to the title */
  badges?: ReactNode;
  /** Secondary line under the title (slug, email, etc.) */
  subtitle?: ReactNode;
  /** Optional description / body under subtitle */
  description?: ReactNode;
  /** Leading media (avatar, icon) */
  leading?: ReactNode;
  /** Extra content below the title block (e.g. summary field grid) */
  children?: ReactNode;
  /** Right-hand block (headline figure, quick facts); stacks under on phones. */
  aside?: ReactNode;
  className?: string;
};

/**
 * Detail-page hero card — shared by Users, Roles, and future modules.
 */
export function EntityHeader({
  title,
  badges,
  subtitle,
  description,
  leading,
  children,
  aside,
  className,
}: EntityHeaderProps) {
  return (
    <Card className={cn("shadow-none", className)}>
      <CardContent
        className={cn(
          "flex flex-col gap-4 p-4 sm:gap-6 sm:p-6",
          leading || aside ? "sm:flex-row sm:items-center" : undefined,
        )}
      >
        {leading}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-xl font-semibold tracking-tight break-words">
              {title}
            </h2>
            {badges}
          </div>
          {subtitle ? (
            <div className="text-muted-foreground text-sm">{subtitle}</div>
          ) : null}
          {description ? <div className="text-sm">{description}</div> : null}
          {children}
        </div>
        {aside ? <div className="shrink-0 sm:text-end">{aside}</div> : null}
      </CardContent>
    </Card>
  );
}
