/** Local calendar date (yyyy-MM-dd); UTC would show yesterday after midnight in TR. */
export function localToday(): string {
  return toISODate(new Date());
}

export function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

function toISODate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}
