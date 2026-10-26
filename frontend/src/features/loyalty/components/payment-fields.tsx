"use client";

import { useFormContext } from "react-hook-form";

import { AppSelect } from "@/components/forms";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import { useLocale } from "@/providers/locale-provider";

export const PAYMENT_METHODS = ["cash", "card", "cari"] as const;

/** Default finance account (the default one, else the first active). */
export function useDefaultAccount() {
  const accounts = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const items = accounts.data?.items ?? [];
  return {
    accounts: items,
    defaultUuid: items.find((a) => a.is_default)?.uuid ?? items[0]?.uuid ?? "",
  };
}

/** Method + finance account fields (`method`, `finance_account_uuid`). */
export function PaymentFields() {
  const { t } = useLocale();
  const { accounts } = useDefaultAccount();
  const form = useFormContext<{
    method: string;
    finance_account_uuid?: string;
  }>();
  const method = form.watch("method");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AppSelect
        name="method"
        label={t("loyalty.fields.method")}
        options={PAYMENT_METHODS.map((value) => ({
          value,
          label: t(`loyalty.method.${value}`),
        }))}
      />
      {method !== "cari" ? (
        <AppSelect
          name="finance_account_uuid"
          label={t("loyalty.fields.finance_account")}
          placeholder={t("loyalty.fields.pick_account")}
          options={accounts.map((a) => ({
            value: a.uuid,
            label: `${a.name} (${a.currency})`,
          }))}
        />
      ) : (
        <p className="text-muted-foreground self-end pb-2 text-sm">
          {t("loyalty.fields.cari_hint")}
        </p>
      )}
    </div>
  );
}

/** zod refinement message key for a missing account on cash / card. */
export function needsAccount(method: string, account?: string) {
  return (method === "cash" || method === "card") && !account;
}
