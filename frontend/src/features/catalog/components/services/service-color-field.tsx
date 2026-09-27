"use client";

import { Check } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";

import {
  resolveServiceColor,
  SERVICE_COLORS,
  swatchOf,
} from "@/features/catalog/lib/service-colors";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/** Palette picker for the tag colour shown on job cards. */
export function ServiceColorField() {
  const { t } = useLocale();
  const { setValue, control } = useFormContext<{
    color?: string;
    name?: string;
  }>();
  const color = useWatch({ control, name: "color" }) ?? "";
  const name = useWatch({ control, name: "name" }) ?? "";
  const effective = resolveServiceColor(color, name);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t("catalog.services.color")}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            swatchOf(effective).badge,
          )}
        >
          {name || t("catalog.services.color_preview")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setValue("color", "", { shouldDirty: true })}
          className={cn(
            "text-muted-foreground h-7 rounded-full border px-2.5 text-xs",
            color === "" && "border-primary text-foreground",
          )}
        >
          {t("catalog.services.color_auto")}
        </button>
        {SERVICE_COLORS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={key}
            aria-pressed={color === key}
            onClick={() => setValue("color", key, { shouldDirty: true })}
            className={cn(
              "ring-offset-background grid size-7 place-items-center rounded-full transition",
              swatchOf(key).dot,
              color === key && "ring-foreground ring-2 ring-offset-2",
            )}
          >
            {color === key ? <Check className="size-3.5 text-white" /> : null}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        {t("catalog.services.color_hint")}
      </p>
    </div>
  );
}
