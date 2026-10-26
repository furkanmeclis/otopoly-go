"use client";

import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import {
  estimateSms,
  type SegmentProvider,
} from "@/features/messaging/lib/sms-segments";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type SmsSegmentCounterProps = {
  body: string;
  provider?: SegmentProvider;
  className?: string;
};

/** Live "123 characters · 1 SMS" counter with the encoding used. */
export function SmsSegmentCounter({
  body,
  provider = "netgsm",
  className,
}: SmsSegmentCounterProps) {
  const { t } = useLocale();
  const est = useMemo(() => estimateSms(body, provider), [body, provider]);
  return (
    <div
      className={cn(
        "text-muted-foreground flex flex-wrap items-center gap-2 text-xs",
        className,
      )}
    >
      <span>
        {t("messaging.sms.segments.summary", {
          characters: est.characters,
          segments: est.segments,
        })}
      </span>
      <span>·</span>
      <span>
        {t("messaging.sms.segments.remaining", { remaining: est.remaining })}
      </span>
      <Badge
        variant={est.encoding === "ucs2" ? "warning" : "outline"}
        className="text-[10px]"
      >
        {t(`messaging.sms.segments.encoding.${est.encoding}`)}
      </Badge>
      {est.encoding === "ucs2" ? (
        <span>{t("messaging.sms.segments.ucs2_hint")}</span>
      ) : null}
    </div>
  );
}
