"use client";

// TODO(finance): Support edit mode — pass optional `account`, use patchAccount, bank_name/iban/notes fields.

import { useMemo } from "react";
import { z } from "zod";

import { AppForm, AppInput, AppSelect } from "@/components/forms";
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
import { useFinanceMutations } from "@/features/finance/hooks/use-finance-mutations";
import { createAccountSchema } from "@/features/finance/schemas/forms";
import { useLocale } from "@/providers/locale-provider";

type FinanceAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function FinanceAccountDialog({
  open,
  onOpenChange,
  onSuccess,
}: FinanceAccountDialogProps) {
  const { t } = useLocale();
  const { createAccount } = useFinanceMutations();
  const schema = useMemo(() => createAccountSchema(t), [t]);

  async function onSubmit(values: z.infer<typeof schema>) {
    await createAccount.mutateAsync({
      name: values.name,
      type: values.type,
      currency: values.currency.toUpperCase(),
      opening_balance: values.opening_balance ?? "0",
    });
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.accounts.create")}</DialogTitle>
          <DialogDescription>
            {t("finance.accounts.create_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "open" : "closed"}
          schema={schema}
          defaultValues={{
            name: "",
            type: "cash",
            currency: "TRY",
            opening_balance: "0",
          }}
          onSubmit={onSubmit}
        >
          <FieldGroup>
            <AppInput name="name" label={t("finance.accounts.name")} />
            <AppSelect
              name="type"
              label={t("finance.accounts.type")}
              options={[
                { value: "cash", label: t("finance.accounts.type_cash") },
                { value: "bank", label: t("finance.accounts.type_bank") },
              ]}
            />
            <AppInput
              name="currency"
              label={t("finance.accounts.currency")}
              maxLength={3}
              placeholder="TRY"
            />
            <AppInput
              name="opening_balance"
              label={t("finance.accounts.opening_balance")}
              inputMode="decimal"
              placeholder="0.00"
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
                <Button type="submit" disabled={createAccount.isPending}>
                  {createAccount.isPending
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
