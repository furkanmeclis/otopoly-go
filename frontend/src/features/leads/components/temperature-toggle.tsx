"use client";

import { Flame, Snowflake, Sun } from "lucide-react";

import { TEMPERATURE_CLASSES } from "@/features/leads/lib/lead-ui";
import {
  LEAD_TEMPERATURES,
  type LeadTemperature,
} from "@/features/leads/types";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const ICONS = { cold: Snowflake, warm: Sun, hot: Flame } as const;

/** Read-only temperature pill. */
export function TemperatureBadge({
  value,
  className,
}: {
  value: LeadTemperature;
  className?: string;
}) {
  const { t } = useLocale();
  const Icon = ICONS[value];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TEMPERATURE_CLASSES[value],
        className,
      )}
    >
      <Icon className="size-3" />
      {t(`leads.temperature.${value}`)}
    </span>
  );
}

/** Segmented cold / warm / hot switch; one tap changes the lead. */
export function TemperatureToggle({
  value,
  onChange,
  disabled,
  size = "md",
}: {
  value: LeadTemperature;
  onChange: (next: LeadTemperature) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const { t } = useLocale();
  return (
    <div
      role="radiogroup"
      aria-label={t("leads.fields.temperature")}
      className="bg-muted inline-flex rounded-full p-0.5"
    >
      {LEAD_TEMPERATURES.map((temp) => {
        const Icon = ICONS[temp];
        const active = temp === value;
        return (
          <button
            key={temp}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={t(`leads.temperature.${temp}`)}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (!active) onChange(temp);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-transparent font-medium transition-colors disabled:opacity-50",
              size === "sm"
                ? "px-1.5 py-0.5 text-[11px]"
                : "px-2.5 py-1 text-xs",
              active
                ? TEMPERATURE_CLASSES[temp]
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className={size === "sm" ? "size-3" : "size-3.5"} />
            <span className={size === "sm" ? "sr-only sm:not-sr-only" : ""}>
              {t(`leads.temperature.${temp}`)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
