import { formatFinanceAmount } from "@/features/finance/lib/format";
import type {
  LoyaltyCampaign,
  PackageState,
  StampCard,
  SubscriptionState,
} from "@/features/loyalty/services/loyalty.service";
import type { AppLocale } from "@/config/i18n";

type T = (key: string, params?: Record<string, string | number>) => string;

/** "Ücretsiz İç-dış yıkama" / "%20 indirim" / "₺100 indirim". */
export function rewardLabel(
  reward: Pick<
    LoyaltyCampaign | StampCard,
    "reward_type" | "reward_value" | "reward_service"
  >,
  t: T,
  locale: AppLocale,
) {
  switch (reward.reward_type) {
    case "free_service":
      return t("loyalty.reward.free_service", {
        service: reward.reward_service?.name ?? "—",
      });
    case "percent":
      return t("loyalty.reward.percent", {
        value: Number(reward.reward_value).toLocaleString(
          locale === "tr" ? "tr-TR" : "en-US",
        ),
      });
    default:
      return t("loyalty.reward.fixed", {
        value: formatFinanceAmount(reward.reward_value, "TRY", locale),
      });
  }
}

export function packageStateTone(state: PackageState) {
  switch (state) {
    case "active":
      return "success" as const;
    case "used_up":
      return "default" as const;
    case "expired":
      return "warning" as const;
    default:
      return "danger" as const;
  }
}

export function subscriptionStateTone(state: SubscriptionState) {
  switch (state) {
    case "active":
      return "success" as const;
    case "past_due":
      return "warning" as const;
    default:
      return "danger" as const;
  }
}

/** "3 gün sonra" / "bugün" / "2 gün gecikti". */
export function renewalLabel(days: number, t: T) {
  if (days === 0) return t("loyalty.renewal.today");
  if (days > 0) return t("loyalty.renewal.in_days", { count: days });
  return t("loyalty.renewal.overdue_days", { count: -days });
}
