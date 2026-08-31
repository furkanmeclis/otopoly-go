import type { AppLocale } from "@/config/i18n";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  accountTypeLabelKey,
  categoryKindLabelKey,
  transactionTypeLabelKey,
} from "@/features/finance/lib/labels";

import type { SearchHit } from "@/features/search-engine/types";

type TranslateFn = (key: string) => string;

const TX_TYPES = new Set(["income", "expense", "transfer"]);
const ACCOUNT_TYPES = new Set(["cash", "bank"]);
const CATEGORY_KINDS = new Set(["income", "expense"]);

const ACCOUNT_SUBTITLE =
  /^([\d.,]+)\s+([A-Za-z]{3})\s+·\s+(cash|bank)$/;
const TRANSACTION_SUBTITLE =
  /^([\d.,]+)\s+([A-Za-z]{3})\s+·\s+(income|expense|transfer)\s+·\s+(.+)$/;

function localizeEnumLabel(
  value: string,
  t: TranslateFn,
  keys: { type: "account" | "transaction" | "category" },
): string {
  const normalized = value.trim().toLowerCase();
  switch (keys.type) {
    case "account":
      if (ACCOUNT_TYPES.has(normalized))
        return t(accountTypeLabelKey(normalized));
      break;
    case "transaction":
      if (TX_TYPES.has(normalized))
        return t(transactionTypeLabelKey(normalized));
      break;
    case "category":
      if (CATEGORY_KINDS.has(normalized))
        return t(categoryKindLabelKey(normalized));
      break;
  }
  return value;
}

/** Localizes finance search hit titles (e.g. fallback transaction type). */
export function formatSearchHitLabel(hit: SearchHit, t: TranslateFn): string {
  const title = hit.title.trim();
  if (!title) return hit.title;

  if (hit.spec === "tenant_finance_transactions" && TX_TYPES.has(title)) {
    return t(transactionTypeLabelKey(title));
  }
  if (hit.spec === "tenant_finance_categories" && CATEGORY_KINDS.has(title)) {
    return t(categoryKindLabelKey(title));
  }
  return hit.title;
}

/** Localizes finance search subtitles and formats currency by locale. */
export function formatSearchHitSubtitle(
  hit: SearchHit,
  t: TranslateFn,
  locale: AppLocale,
): string | undefined {
  const subtitle = hit.subtitle?.trim();
  if (!subtitle) return undefined;

  switch (hit.spec) {
    case "tenant_finance_accounts": {
      const match = subtitle.match(ACCOUNT_SUBTITLE);
      if (!match) return subtitle;
      const [, amount, currency, accountType] = match;
      return `${formatFinanceAmount(amount, currency, locale)} · ${t(accountTypeLabelKey(accountType))}`;
    }
    case "tenant_finance_transactions": {
      const match = subtitle.match(TRANSACTION_SUBTITLE);
      if (!match) return subtitle;
      const [, amount, currency, txType, accountName] = match;
      return `${formatFinanceAmount(amount, currency, locale)} · ${t(transactionTypeLabelKey(txType))} · ${accountName}`;
    }
    case "tenant_finance_categories":
      return localizeEnumLabel(subtitle, t, { type: "category" });
    default:
      return hit.subtitle;
  }
}

export function isFinanceSearchSpec(spec: string): boolean {
  return spec.startsWith("tenant_finance_");
}
