"use client";

import { AlertTriangle, Ban, Check, Clock, Loader2 } from "lucide-react";

import {
  isSummaryKey,
  toolLabelKey,
  toolRunningKey,
} from "@/features/ai/lib/labels";
import type { AIUIBlock } from "@/features/ai/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Compact indicator for one tool call ("Müşteriler aranıyor…" → "3 müşteri bulundu"). */
export function ToolActivity({
  block,
  recovered = false,
}: {
  block: AIUIBlock;
  recovered?: boolean;
}) {
  const { t } = useLocale();
  const name = block.name ?? "";
  const status = block.status ?? "running";
  const params = (block.summary_params ?? {}) as Record<
    string,
    string | number
  >;
  const label =
    status === "running"
      ? t(toolRunningKey(name))
      : status === "done" && isSummaryKey(block.summary_key)
        ? t(block.summary_key, params)
        : t(toolLabelKey(name));

  const retryLabel = recovered ? t("ai.tool_status.retried") : undefined;

  const Icon =
    status === "running"
      ? Loader2
      : status === "error"
        ? AlertTriangle
        : status === "pending"
          ? Clock
          : status === "cancelled"
            ? Ban
            : Check;

  return (
    <div
      className={cn(
        "text-muted-foreground inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        status === "error" &&
          !recovered &&
          "border-destructive/40 text-destructive",
      )}
      data-tool={name}
      data-status={status}
      data-recovered={recovered ? "true" : undefined}
      title={retryLabel}
      aria-label={retryLabel ? `${label} - ${retryLabel}` : label}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          status === "running" && "animate-spin",
          status === "done" && "text-emerald-600 dark:text-emerald-400",
        )}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}
