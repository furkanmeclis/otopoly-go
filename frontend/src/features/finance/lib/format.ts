import type { AppLocale } from "@/config/i18n";
import { businessMonthStart, businessToday } from "@/lib/utils/business-date";

/** First day of this business month (Europe/Istanbul, yyyy-MM-dd). */
export function financeMonthStart(): string {
  return businessMonthStart();
}

/** Today's business day (Europe/Istanbul, yyyy-MM-dd). */
export function financeToday(): string {
  return businessToday();
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

/** Locale-aware quantity (1.500 / 2,5) without trailing zeros. */
export function formatQuantity(
  value: string | number | undefined | null,
  locale: AppLocale,
): string {
  if (value === undefined || value === null || value === "") return "—";
  const num = typeof value === "string" ? Number.parseFloat(value) : value;
  if (Number.isNaN(num)) return String(value);
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", {
    maximumFractionDigits: 3,
  }).format(num);
}
