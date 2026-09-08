"use client";

import { useMemo } from "react";
import { z } from "zod";

import { AppForm, AppInput, AppTextarea } from "@/components/forms";
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
import { useCatalogMutations } from "@/features/catalog/hooks/use-catalog-mutations";
import { catalogUnitLabel } from "@/features/catalog/lib/units";
import type { CatalogProduct } from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";

type StockAdjustmentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: CatalogProduct | null;
  onSuccess?: () => void;
};

export function StockAdjustmentDialog({
  open,
  onOpenChange,
  product,
  onSuccess,
}: StockAdjustmentDialogProps) {
  const { t } = useLocale();
  const { adjustStock } = useCatalogMutations();

  const schema = useMemo(
    () =>
      z.object({
        delta: z.string().min(1, t("form.required")),
        reason: z.string().optional(),
        description: z.string().optional(),
      }),
    [t],
  );

  if (!product) return null;

  async function onSubmit(values: z.infer<typeof schema>) {
    if (!product) return;
    await adjustStock.mutateAsync({
      uuid: product.uuid,
      body: {
        delta: values.delta,
        reason: values.reason,
        description: values.description,
      },
    });
    onOpenChange(false);
    onSuccess?.();
  }

  const currentQty = Number(product.stock_quantity) || 0;
  const unitLabel = catalogUnitLabel(t, product.unit);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("catalog.adjust_dialog.title")}</DialogTitle>
          <DialogDescription>
            {product.name} ({currentQty} {unitLabel})
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={product.uuid}
          schema={schema}
          defaultValues={{ delta: "", reason: "", description: "" }}
          onSubmit={onSubmit}
        >
          {(form) => {
            const deltaVal = form.watch("delta");
            const deltaNum = Number(deltaVal) || 0;
            const newQty = currentQty + deltaNum;

            return (
              <>
                <FieldGroup className="gap-4">
                  <div className="bg-muted/40 flex items-center justify-between rounded-lg p-3 text-sm">
                    <span className="text-muted-foreground">
                      {t("catalog.adjust_dialog.current_stock")}:
                    </span>
                    <span className="text-foreground font-semibold">
                      {currentQty} {unitLabel}
                    </span>
                  </div>

                  <AppInput
                    name="delta"
                    label={t("catalog.adjust_dialog.delta")}
                    placeholder={t("catalog.adjust_dialog.delta_placeholder")}
                    type="number"
                    step="any"
                    required
                  />

                  <div className="flex items-center justify-between rounded-lg border border-dashed p-3 text-sm">
                    <span className="text-muted-foreground">
                      {t("catalog.adjust_dialog.new_stock")}:
                    </span>
                    <span
                      className={`font-bold ${
                        newQty < 0
                          ? "text-destructive"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {newQty} {unitLabel}
                    </span>
                  </div>

                  <AppInput
                    name="reason"
                    label={t("catalog.adjust_dialog.reason")}
                    placeholder={t("catalog.adjust_dialog.reason_placeholder")}
                  />

                  <AppTextarea
                    name="description"
                    label={t("catalog.adjust_dialog.note")}
                    rows={2}
                  />
                </FieldGroup>
                <DialogFooter className="mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button type="submit" disabled={adjustStock.isPending}>
                    {adjustStock.isPending
                      ? t("common.saving")
                      : t("catalog.adjust_dialog.submit")}
                  </Button>
                </DialogFooter>
              </>
            );
          }}
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
