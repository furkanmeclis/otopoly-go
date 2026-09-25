"use client";

import { useState } from "react";
import { BellRing, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_OFFSET_MINUTES,
  MAX_REMINDERS,
  PRESET_OFFSETS,
  offsetLabel,
  sortOffsets,
} from "@/features/todos/lib/reminders";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

type Props = {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  hasTime: boolean;
};

export function ReminderPicker({ value, onChange, disabled, hasTime }: Props) {
  const { t } = useLocale();
  const [customOpen, setCustomOpen] = useState(false);
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<Unit>("minutes");
  const full = value.length >= MAX_REMINDERS;
  const custom = value.filter(
    (v) => !(PRESET_OFFSETS as readonly number[]).includes(v),
  );

  const toggle = (minutes: number) => {
    if (value.includes(minutes)) {
      onChange(value.filter((v) => v !== minutes));
    } else if (!full) {
      onChange(sortOffsets([...value, minutes]));
    }
  };

  const addCustom = () => {
    const n = Number.parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const minutes = Math.min(n * UNIT_MINUTES[unit], MAX_OFFSET_MINUTES);
    if (!value.includes(minutes) && !full) {
      onChange(sortOffsets([...value, minutes]));
    }
    setCustomOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group">
        {PRESET_OFFSETS.map((minutes) => {
          const on = value.includes(minutes);
          return (
            <Button
              key={minutes}
              type="button"
              size="sm"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              disabled={disabled || (!on && full)}
              onClick={() => toggle(minutes)}
              className="h-8 gap-1 rounded-full px-3 text-xs"
            >
              {on ? <BellRing className="size-3" /> : null}
              {offsetLabel(t, minutes)}
            </Button>
          );
        })}
        {custom.map((minutes) => (
          <Button
            key={minutes}
            type="button"
            size="sm"
            variant="default"
            disabled={disabled}
            onClick={() => toggle(minutes)}
            className="h-8 gap-1 rounded-full px-3 text-xs"
            aria-label={`${t("todos.reminders.remove")}: ${offsetLabel(t, minutes)}`}
          >
            {offsetLabel(t, minutes)}
            <X className="size-3" />
          </Button>
        ))}
        {!customOpen ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || full}
            onClick={() => setCustomOpen(true)}
            className="h-8 rounded-full px-3 text-xs"
          >
            <Plus className="size-3" />
            {t("todos.reminders.custom")}
          </Button>
        ) : null}
      </div>
      {customOpen && !disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 w-20"
            aria-label={t("todos.reminders.custom")}
          />
          <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
            <SelectTrigger className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutes">
                {t("todos.reminders.unit_minutes")}
              </SelectItem>
              <SelectItem value="hours">
                {t("todos.reminders.unit_hours")}
              </SelectItem>
              <SelectItem value="days">
                {t("todos.reminders.unit_days")}
              </SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="h-8" onClick={addCustom}>
            {t("todos.reminders.custom_add")}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => setCustomOpen(false)}
            aria-label={t("common.cancel")}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
      <p className={cn("text-muted-foreground text-xs")}>
        {disabled
          ? t("todos.reminders.need_date")
          : full
            ? t("todos.reminders.max")
            : !hasTime
              ? t("todos.reminders.date_only_hint")
              : null}
      </p>
    </div>
  );
}
