import type { AppLocale } from "@/config/i18n";

export function financeMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
}

export function financeToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatFinanceAmount(
  amount: string | number | undefined | null,
  currency: string | null | undefined,
  locale: AppLocale,
): string {
  if (amount === undefined || amount === null || amount === "") return "—";
  const num = typeof amount === "string" ? Number.parseFloat(amount) : amount;
  if (Number.isNaN(num)) return String(amount);

  const curr = (currency ?? "TRY").trim().toUpperCase() || "TRY";
  try {
    return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
      style: "currency",
      currency: curr,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${curr}`;
  }
}

export function parseFinanceAmount(value: string | undefined | null): number {
  if (!value) return 0;
  const num = Number.parseFloat(value);
  return Number.isNaN(num) ? 0 : num;
}

/** Truncate long text for table cells; full value should go in `title`. */
export function truncateText(text: string, maxLength = 72): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trimEnd()}…`;
}
