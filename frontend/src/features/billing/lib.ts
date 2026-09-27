import type { AppLocale } from "@/config/i18n";
import type { BillingPlan, BillingUsageMeter } from "@/features/billing/types";

export function meterLabel(
  meter: { label_tr: string; label_en: string; key: string },
  locale: AppLocale,
) {
  const label = locale === "tr" ? meter.label_tr : meter.label_en;
  return label || meter.key;
}

export function meterUnlimited(meter: BillingUsageMeter) {
  return meter.limit === null || meter.limit === undefined || meter.limit < 0;
}

export function meterTone(meter: BillingUsageMeter): "ok" | "warn" | "over" {
  if (meterUnlimited(meter)) return "ok";
  const limit = meter.limit as number;
  if (meter.used >= limit) return "over";
  if (limit > 0 && meter.used * 100 >= limit * meter.warn_pct) return "warn";
  return "ok";
}

/** Yearly price shown for a plan; mirrors backend YearlyPrice (spec #12). */
export function yearlyPrice(
  plan: Pick<
    BillingPlan,
    | "price_monthly"
    | "yearly_pricing"
    | "price_yearly"
    | "yearly_discount_value"
  >,
) {
  const monthly = Number.parseFloat(plan.price_monthly) || 0;
  const value = Number.parseFloat(plan.yearly_discount_value) || 0;
  let total: number;
  switch (plan.yearly_pricing) {
    case "discount_amount":
      total = monthly * 12 - value;
      break;
    case "discount_percent":
      total = monthly * 12 * (1 - value / 100);
      break;
    default:
      total = Number.parseFloat(plan.price_yearly) || 0;
  }
  return Math.max(0, total).toFixed(2);
}
