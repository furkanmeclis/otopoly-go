"use client";

import { Clock } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

export type TimePickerProps = {
  id?: string;
  /** `HH:mm` (24h), or empty string when unset. */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Hides the "clear" action (the field must always hold a time). */
  required?: boolean;
  className?: string;
  align?: React.ComponentProps<typeof PopoverContent>["align"];
  "aria-invalid"?: boolean;
  "aria-label"?: string;
};

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

function parseTime(value: string | undefined): [string, string] | null {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const [, h, m] = match;
  if (Number(h) > 23 || Number(m) > 59) return null;
  return [h, m];
}

/**
 * Shared time picker (Popover + hour / minute columns), replacing the native
 * `<input type="time">`. Value is always `HH:mm` (empty string when cleared).
 */
export function TimePicker({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  className,
  align = "start",
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
}: TimePickerProps) {
  const { t } = useLocale();
  const [open, setOpen] = React.useState(false);
  const parsed = parseTime(value);
  const hour = parsed?.[0];
  const minute = parsed?.[1];

  const pick = (h: string, m: string) => onChange?.(`${h}:${m}`);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          data-empty={!parsed}
          className={cn(
            "data-[empty=true]:text-muted-foreground h-9 w-full justify-start gap-2 px-3 font-normal tabular-nums",
            className,
          )}
        >
          <Clock className="text-muted-foreground size-4" />
          {parsed ? `${hour}:${minute}` : (placeholder ?? "--:--")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="flex">
          <TimeColumn
            label={t("form.time_hour")}
            items={HOURS}
            selected={hour}
            onPick={(h) => pick(h, minute ?? "00")}
          />
          <TimeColumn
            label={t("form.time_minute")}
            items={MINUTES}
            selected={minute}
            onPick={(m) => pick(hour ?? "00", m)}
            className="border-l"
          />
        </div>
        {!required && parsed ? (
          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange?.("");
                setOpen(false);
              }}
            >
              {t("form.clear")}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function TimeColumn({
  label,
  items,
  selected,
  onPick,
  className,
}: {
  label: string;
  items: string[];
  selected?: string;
  onPick: (value: string) => void;
  className?: string;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  // Bring the selected entry into view when the popover opens.
  React.useEffect(() => {
    const list = listRef.current;
    const node = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && node) {
      // Scroll the column only; scrollIntoView would also move the page.
      list.scrollTop =
        node.offsetTop - list.clientHeight / 2 + node.clientHeight / 2;
    }
  }, [selected]);

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      className={cn(
        "relative flex h-56 w-14 flex-col gap-0.5 overflow-y-auto p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = item === selected;
        return (
          <Button
            key={item}
            type="button"
            role="option"
            aria-selected={active}
            variant={active ? "default" : "ghost"}
            size="sm"
            className="h-8 shrink-0 justify-center px-0 tabular-nums"
            onClick={() => onPick(item)}
          >
            {item}
          </Button>
        );
      })}
    </div>
  );
}
