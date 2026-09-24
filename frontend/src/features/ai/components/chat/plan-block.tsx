"use client";

import { Check, Circle, CircleDashed, ListChecks, Minus } from "lucide-react";

import type { AIPlan, AIUIBlock } from "@/features/ai/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const ICONS = {
  done: Check,
  in_progress: CircleDashed,
  skipped: Minus,
  pending: Circle,
} as const;

/** The assistant's plan for a multi-step request (updated in place). */
export function PlanBlock({ block }: { block: AIUIBlock }) {
  const { t } = useLocale();
  const plan = block.data as AIPlan | undefined;
  if (!plan?.items?.length) return null;
  const done = plan.items.filter((i) => i.status === "done").length;
  return (
    <div
      className="bg-muted/30 rounded-lg border px-3 py-2.5"
      data-block="plan"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <ListChecks className="text-primary size-3.5" />
          {plan.title || t("ai.plan.title")}
        </p>
        <span className="text-muted-foreground text-[11px]">
          {t("ai.plan.progress", { done, total: plan.items.length })}
        </span>
      </div>
      <ul className="space-y-1">
        {plan.items.map((item, i) => {
          const Icon = ICONS[item.status] ?? Circle;
          return (
            <li
              key={`${i}-${item.text}`}
              className={cn(
                "flex items-start gap-2 text-sm",
                item.status === "done" && "text-muted-foreground line-through",
                item.status === "skipped" && "text-muted-foreground",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  item.status === "done" &&
                    "text-emerald-600 dark:text-emerald-400",
                  item.status === "in_progress" && "text-primary animate-pulse",
                )}
              />
              <span>{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
