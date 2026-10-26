"use client";

import { useMemo } from "react";
import { z } from "zod";

import { AppForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import {
  PaymentFields,
  needsAccount,
  useDefaultAccount,
} from "@/features/loyalty/components/payment-fields";
import { useLoyaltyMutations } from "@/features/loyalty/hooks/use-loyalty";
import type { SubscriptionDetail } from "@/features/loyalty/services/loyalty.service";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

/** Collect the next period of a subscription. */
export function PaySubscriptionDialog({
  open,
  onOpenChange,
  subscription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription: SubscriptionDetail;
}) {
  const { t, locale } = useLocale();
  const { paySubscription } = useLoyaltyMutations();
  const { defaultUuid } = useDefaultAccount();
  const schema = useMemo(
    () =>
      z
        .object({
          method: z.enum(["cash", "card", "cari"]),
          finance_account_uuid: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (needsAccount(v.method, v.finance_account_uuid)) {
            ctx.addIssue({
              code: "custom",
              path: ["finance_account_uuid"],
              message: t("loyalty.validation.finance_account"),
            });
          }
        }),
    [t],
  );
  const period = subscription.next_period;
  const end = new Date(`${period.end}T00:00:00`);
  end.setDate(end.getDate() - 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("loyalty.pay.title")}</DialogTitle>
          <DialogDescription>
            {t("loyalty.pay.description", {
              from: date(period.start, "dd.MM.yyyy", locale),
              to: date(end, "dd.MM.yyyy", locale),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5">
          <span className="truncate text-sm font-medium">
            {subscription.customer_name} · {subscription.name}
          </span>
          <span className="text-lg font-semibold tabular-nums">
            {formatFinanceAmount(
              subscription.price,
              subscription.currency,
              locale,
            )}
          </span>
        </div>
        <AppForm
          key={open ? `pay-${defaultUuid}` : "pay-closed"}
          schema={schema}
          defaultValues={{ method: "cash", finance_account_uuid: defaultUuid }}
          onSubmit={async (v) => {
            await paySubscription.mutateAsync({
              uuid: subscription.uuid,
              body: {
                method: v.method,
                finance_account_uuid:
                  v.method === "cari" ? null : v.finance_account_uuid || null,
              },
            });
            onOpenChange(false);
          }}
        >
          <FieldGroup className="gap-4">
            <PaymentFields />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={paySubscription.isPending}>
              {paySubscription.isPending
                ? t("common.saving")
                : t("loyalty.pay.submit")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
