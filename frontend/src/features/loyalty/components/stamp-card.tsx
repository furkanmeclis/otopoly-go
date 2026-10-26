"use client";

import { Gift } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { rewardLabel } from "@/features/loyalty/lib/labels";
import type { StampCard } from "@/features/loyalty/services/loyalty.service";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** One campaign: stamp dots + reward line. */
export function StampCardView({ card }: { card: StampCard }) {
  const { t, locale } = useLocale();
  const dots = Math.min(card.stamps_required, 20);
  const filled =
    card.rewards_available > 0
      ? dots
      : Math.round((card.stamps / Math.max(card.stamps_required, 1)) * dots);
  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{card.campaign_name}</p>
          <p className="text-muted-foreground text-xs">
            {rewardLabel(card, t, locale)}
          </p>
        </div>
        {card.rewards_available > 0 ? (
          <Badge variant="success" className="shrink-0 gap-1">
            <Gift className="size-3" />
            {t("loyalty.stamps.ready", { count: card.rewards_available })}
          </Badge>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {t("loyalty.stamps.progress", {
              stamps: card.stamps,
              required: card.stamps_required,
            })}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1" aria-hidden>
        {Array.from({ length: dots }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "size-3 rounded-full border",
              i < filled ? "bg-primary border-primary" : "bg-muted",
            )}
          />
        ))}
      </div>
      {!card.active ? (
        <p className="text-muted-foreground text-xs">
          {t("loyalty.stamps.inactive")}
        </p>
      ) : card.limit_reached ? (
        <p className="text-muted-foreground text-xs">
          {t("loyalty.stamps.limit_reached")}
        </p>
      ) : null}
    </div>
  );
}
