"use client";

import { Sparkles } from "lucide-react";

import { unavailableKey } from "@/features/ai/lib/labels";
import { useLocale } from "@/providers/locale-provider";

export function AssistantUnavailable({ reason }: { reason?: string | null }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
        <Sparkles className="size-6" />
      </div>
      <h3 className="text-base font-semibold">{t("ai.unavailable.title")}</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        {t(unavailableKey(reason))}
      </p>
    </div>
  );
}
