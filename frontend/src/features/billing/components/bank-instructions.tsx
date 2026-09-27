"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { BankInstructions as Instructions } from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

function groupIban(iban: string) {
  return iban
    .replace(/\s+/g, "")
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

export function BankInstructions({
  instructions,
  expiresAt,
}: {
  instructions: Instructions;
  expiresAt?: string;
}) {
  const { t, locale } = useLocale();
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("billing.bank.copied"));
    } catch {
      /* clipboard blocked — the value stays selectable */
    }
  };
  if (!instructions.iban) {
    return (
      <p className="text-muted-foreground text-sm">
        {t("billing.bank.missing")}
      </p>
    );
  }
  const rows: Array<{
    label: string;
    value: string;
    display?: string;
    mono?: boolean;
    strong?: boolean;
  }> = [
    { label: t("billing.bank.bank_name"), value: instructions.bank_name },
    {
      label: t("billing.bank.account_holder"),
      value: instructions.account_holder,
    },
    {
      label: t("billing.bank.iban"),
      value: instructions.iban.replace(/\s+/g, ""),
      display: groupIban(instructions.iban),
      mono: true,
    },
    {
      label: t("billing.bank.amount"),
      value: instructions.amount,
      display: formatFinanceAmount(instructions.amount, "TRY", locale),
      strong: true,
    },
    {
      label: t("billing.bank.reference"),
      value: instructions.reference_code,
      mono: true,
      strong: true,
    },
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y rounded-lg border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <dt className="text-muted-foreground text-xs">{row.label}</dt>
              <dd
                className={[
                  "truncate text-sm",
                  row.mono ? "font-mono tracking-wide" : "",
                  row.strong ? "font-semibold" : "",
                ].join(" ")}
              >
                {row.display ?? row.value}
              </dd>
            </div>
            {row.value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copy(row.value)}
                aria-label={`${t("billing.bank.copy")}: ${row.label}`}
              >
                <Copy className="size-3.5" />
              </Button>
            ) : null}
          </div>
        ))}
      </dl>
      <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
        {t("billing.bank.reference_hint")}
      </p>
      {instructions.payment_instructions ? (
        <p className="text-muted-foreground text-xs whitespace-pre-line">
          {instructions.payment_instructions}
        </p>
      ) : null}
      {expiresAt ? (
        <p className="text-muted-foreground text-xs">
          {t("billing.bank.deadline", {
            date: date(expiresAt, "dd.MM.yyyy HH:mm", locale),
          })}
        </p>
      ) : null}
    </div>
  );
}
