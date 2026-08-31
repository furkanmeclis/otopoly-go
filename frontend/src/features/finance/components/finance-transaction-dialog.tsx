"use client";

// TODO(finance): payment_method select with i18n labels; reference_no field; pre-fill account from query.

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
import {
  useFinanceAccounts,
  useFinanceCategories,
} from "@/features/finance/hooks/use-finance-queries";
import { useFinanceMutations } from "@/features/finance/hooks/use-finance-mutations";
import { createTransactionSchema } from "@/features/finance/schemas/forms";
import { useLocale } from "@/providers/locale-provider";

type FinanceTransactionDialogProps = {
  type: "income" | "expense";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function FinanceTransactionDialog({
  type,
  open,
  onOpenChange,
  onSuccess,
}: FinanceTransactionDialogProps) {
  const { t } = useLocale();
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const categoriesQuery = useFinanceCategories(type);
  const { createTransaction } = useFinanceMutations();
  const today = useMemo(() => financeToday(), []);
  const schema = useMemo(() => createTransactionSchema(type, t), [type, t]);

  const title =
    type === "income"
      ? t("finance.actions.add_income")
      : t("finance.actions.add_expense");

  const accounts = accountsQuery.data?.items ?? [];
  const categories = categoriesQuery.data?.items ?? [];

  async function onSubmit(values: z.infer<typeof schema>) {
    const body: Record<string, unknown> = {
      type,
      account_uuid: values.account_uuid,
      amount: values.amount,
      transaction_date: values.transaction_date,
      description: values.description ?? "",
      payment_method: values.payment_method ?? "cash",
    };
    if (values.category_uuid) {
      body.category_uuid = values.category_uuid;
    }
    await createTransaction.mutateAsync(body);
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t("finance.transactions.form_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={`${type}-${open ? "open" : "closed"}`}
          schema={schema}
          defaultValues={{
            account_uuid: "",
            category_uuid: "",
            amount: "",
            transaction_date: today,
            description: "",
            payment_method: "cash",
          }}
          onSubmit={onSubmit}
        >
          <FieldGroup>
            <AppSelect
              name="account_uuid"
              label={t("finance.transactions.account")}
              placeholder={t("finance.transactions.select_account")}
              options={accounts.map((account) => ({
                value: account.uuid,
                label: `${account.name} (${account.currency})`,
              }))}
            />
            {type === "expense" ? (
              <AppSelect
                name="category_uuid"
                label={t("finance.transactions.category")}
                placeholder={t("finance.transactions.select_category")}
                options={categories.map((category) => ({
                  value: category.uuid,
                  label: category.name,
                }))}
              />
            ) : null}
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
                <Button type="submit" disabled={createTransaction.isPending}>
                  {createTransaction.isPending
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
