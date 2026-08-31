"use client";

// TODO(finance): Support edit mode — patchCategory (name, sort_order, is_active, parent_uuid).

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
import { createCategorySchema } from "@/features/finance/schemas/forms";
import { useLocale } from "@/providers/locale-provider";

type FinanceCategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: "income" | "expense";
  onSuccess?: () => void;
};

export function FinanceCategoryDialog({
  open,
  onOpenChange,
  defaultKind = "expense",
  onSuccess,
}: FinanceCategoryDialogProps) {
  const { t } = useLocale();
  const { createCategory } = useFinanceMutations();
  const schema = useMemo(() => createCategorySchema(t), [t]);

  async function onSubmit(values: z.infer<typeof schema>) {
    await createCategory.mutateAsync(values);
    onOpenChange(false);
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("finance.categories.create")}</DialogTitle>
          <DialogDescription>
            {t("finance.categories.create_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={`${defaultKind}-${open ? "open" : "closed"}`}
          schema={schema}
          defaultValues={{ name: "", kind: defaultKind }}
          onSubmit={onSubmit}
        >
          <FieldGroup>
            <AppInput
              name="name"
              label={t("finance.categories.name")}
              placeholder={t("finance.categories.name_placeholder")}
            />
            <AppSelect
              name="kind"
              label={t("finance.categories.kind")}
              options={[
                { value: "income", label: t("finance.categories.kind_income") },
                {
                  value: "expense",
                  label: t("finance.categories.kind_expense"),
                },
              ]}
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
                <Button type="submit" disabled={createCategory.isPending}>
                  {createCategory.isPending
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
