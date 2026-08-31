"use client";

// TODO(finance): reference_no field; pre-fill from/to via props (account detail quick action).

import { useMemo } from "react";
import { z } from "zod";

import {
  AppDatePicker,
  AppForm,
  AppInput,
  AppSelect,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { financeToday } from "@/features/finance/lib/format";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import { useFinanceMutations } from "@/features/finance/hooks/use-finance-mutations";
import { createTransferSchema } from "@/features/finance/schemas/forms";
import { useLocale } from "@/providers/locale-provider";

type FinanceTransferDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function FinanceTransferDialog({
  open,
  onOpenChange,
  onSuccess,
}: FinanceTransferDialogProps) {
  const { t } = useLocale();
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const { createTransfer } = useFinanceMutations();
  const today = useMemo(() => financeToday(), []);
  const schema = useMemo(() => createTransferSchema(t), [t]);

  const accountOptions = (accountsQuery.data?.items ?? []).map((account) => ({
    value: account.uuid,
    label: `${account.name} (${account.currency})`,
  }));

  async function onSubmit(values: z.infer<typeof schema>) {
    await createTransfer.mutateAsync(values);
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.actions.transfer")}</DialogTitle>
          <DialogDescription>
            {t("finance.transfers.form_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "open" : "closed"}
          schema={schema}
          defaultValues={{
            from_account_uuid: "",
            to_account_uuid: "",
            amount: "",
            transaction_date: today,
            description: "",
          }}
          onSubmit={onSubmit}
        >
          <FieldGroup>
            <AppSelect
              name="from_account_uuid"
              label={t("finance.transfers.from")}
              placeholder={t("finance.transactions.select_account")}
              options={accountOptions}
            />
            <AppSelect
              name="to_account_uuid"
              label={t("finance.transfers.to")}
              placeholder={t("finance.transactions.select_account")}
              options={accountOptions}
            />
            <AppInput
              name="amount"
              label={t("finance.transactions.amount")}
              inputMode="decimal"
              placeholder="0.00"
            />
            <AppDatePicker
              name="transaction_date"
              label={t("finance.transactions.date")}
            />
            <AppInput
              name="description"
              label={t("finance.transactions.description")}
              placeholder={t("finance.transactions.description_placeholder")}
            />
            <DialogFooter className="gap-2 pt-2 sm:justify-end">
              <Field className="flex w-full flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={createTransfer.isPending}>
                  {createTransfer.isPending
                    ? t("common.loading")
                    : t("common.save")}
                </Button>
              </Field>
            </DialogFooter>
          </FieldGroup>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
