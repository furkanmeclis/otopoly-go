"use client";

import { Check } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

const HEX_RE = /^#[0-9a-f]{6}$/i;

export const DEFAULT_COLOR_SWATCHES = [
  "#0f172a",
  "#475569",
  "#94a3b8",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#ca8a04",
  "#65a30d",
  "#16a34a",
  "#059669",
  "#0d9488",
  "#0891b2",
  "#0284c7",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#9333ea",
  "#c026d3",
  "#db2777",
  "#e11d48",
] as const;

export type ColorPickerProps = {
  id?: string;
  /** `#rrggbb`. */
  value: string;
  onChange: (value: string) => void;
  swatches?: readonly string[];
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/**
 * Shared colour picker (Popover + swatches + hex input), replacing the native
 * `<input type="color">`. Only complete `#rrggbb` values are emitted.
 */
export function ColorPicker({
  id,
  value,
  onChange,
  swatches = DEFAULT_COLOR_SWATCHES,
  disabled,
  className,
  "aria-label": ariaLabel,
}: ColorPickerProps) {
  const { t } = useLocale();
  const valid = HEX_RE.test(value);
  const [draft, setDraft] = React.useState(value);

  return (
    <Popover onOpenChange={(open) => open && setDraft(value)}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel ?? t("form.color_pick")}
          className={cn("h-9 w-14 shrink-0 p-1", className)}
        >
          <span
            aria-hidden
            className="size-full rounded-sm border"
            style={{ backgroundColor: valid ? value : "transparent" }}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-3 p-3" align="start">
        <div
          role="listbox"
          aria-label={t("form.color_swatches")}
          className="grid grid-cols-5 gap-2"
        >
          {swatches.map((swatch) => {
            const active = swatch.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={swatch}
                type="button"
                role="option"
                aria-selected={active}
                aria-label={swatch}
                onClick={() => {
                  onChange(swatch);
                  setDraft(swatch);
                }}
                className={cn(
                  "ring-offset-background focus-visible:ring-ring grid size-8 place-items-center rounded-md border transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                  active && "ring-foreground ring-2 ring-offset-2",
                )}
                style={{ backgroundColor: swatch }}
              >
                {active ? (
                  <Check className="size-4 text-white drop-shadow" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-9 shrink-0 rounded-md border"
            style={{
              backgroundColor: HEX_RE.test(draft) ? draft : "transparent",
            }}
          />
          <Input
            value={draft}
            aria-label={t("form.color_hex")}
            className="font-mono uppercase"
            maxLength={7}
            onChange={(event) => {
              const next = event.target.value.trim();
              if (!/^#?[0-9a-f]{0,6}$/i.test(next)) return;
              const withHash = next.startsWith("#") ? next : `#${next}`;
              setDraft(withHash);
              if (HEX_RE.test(withHash)) onChange(withHash);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
