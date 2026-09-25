export const PRESET_OFFSETS = [0, 15, 60, 1440] as const;
export const MAX_REMINDERS = 5;
export const MAX_OFFSET_MINUTES = 43200;

type T = (key: string, params?: Record<string, string | number>) => string;

const PRESET_KEYS: Record<number, string> = {
  0: "todos.reminders.at_due",
  15: "todos.reminders.m15",
  60: "todos.reminders.h1",
  1440: "todos.reminders.d1",
};

/** Human label for a reminder offset in minutes. */
export function offsetLabel(t: T, minutes: number): string {
  const preset = PRESET_KEYS[minutes];
  if (preset) return t(preset);
  if (minutes % 1440 === 0) {
    return t("todos.reminders.days_before", { n: minutes / 1440 });
  }
  if (minutes % 60 === 0) {
    return t("todos.reminders.hours_before", { n: minutes / 60 });
  }
  return t("todos.reminders.minutes_before", { n: minutes });
}

export function sortOffsets(offsets: number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => b - a);
}
