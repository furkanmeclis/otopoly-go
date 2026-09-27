import type { AppLocale } from "@/config/i18n";
import type {
  BillingPlan,
  BillingPlanFeatureValue,
  BillingUsageMeter,
} from "@/features/billing/types";

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

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** One human line for a plan feature: "Günlük işlem: 50 adet", "Yapay zekâ asistanı: Dahil". */
export function planFeatureLine(
  f: BillingPlanFeatureValue,
  locale: AppLocale,
  t: Translate,
): string {
  if (f.display_text) return f.display_text;
  const label = (locale === "tr" ? f.label_tr : f.label_en) || f.key;
  if (f.value_bool !== null && f.value_bool !== undefined) {
    return `${label}: ${f.value_bool ? t("billing.features.on") : t("billing.features.off")}`;
  }
  if (f.value_int !== null && f.value_int !== undefined) {
    const n = new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US").format(
      f.value_int,
    );
    return `${label}: ${n}${f.unit ? ` ${f.unit}` : ""}`;
  }
  return `${label}: ${t("billing.usage.unlimited")}`;
}
