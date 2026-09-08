"use client";

import { useMemo } from "react";
import { z } from "zod";

import {
  AppForm,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea,
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
import { FieldGroup } from "@/components/ui/field";
import { useCatalogMutations } from "@/features/catalog/hooks/use-catalog-mutations";
import { useCatalogCategories } from "@/features/catalog/hooks/use-catalog-queries";
import type { CatalogProduct } from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";

type ProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: CatalogProduct | null;
  onSuccess?: () => void;
};

export function ProductDialog({
  open,
  onOpenChange,
  product,
  onSuccess,
}: ProductDialogProps) {
  const { t } = useLocale();
  const isEdit = Boolean(product);
  const { createProduct, updateProduct } = useCatalogMutations();

  const { data: categories } = useCatalogCategories({
    kind: "product",
    is_active: "true",
  });

  const categoryOptions = useMemo(
    () => [
      { value: "", label: `— ${t("catalog.products.category_select")} —` },
      ...(categories?.items || []).map((c) => ({
        value: c.uuid,
        label: c.name,
      })),
    ],
    [categories, t],
  );

  const unitOptions = useMemo(
    () => [
      { value: "piece", label: t("catalog.products.units.piece") },
      { value: "liter", label: t("catalog.products.units.liter") },
      { value: "kg", label: t("catalog.products.units.kg") },
      { value: "meter", label: t("catalog.products.units.meter") },
      { value: "box", label: t("catalog.products.units.box") },
      { value: "set", label: t("catalog.products.units.set") },
    ],
    [t],
  );

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        category_uuid: z.string().optional(),
        sku: z.string().optional(),
        barcode: z.string().optional(),
        unit: z.string().default("piece"),
        cost_price: z.string().default("0"),
        sale_price: z.string().default("0"),
        vat_rate: z.string().default("20"),
        currency: z.string().default("TRY"),
        stock_quantity: z.string().default("0"),
        min_stock_alert: z.string().default("0"),
        track_stock: z.boolean().default(true),
        is_active: z.boolean().default(true),
        description: z.string().optional(),
      }),
    [t],
  );

  const defaultValues = useMemo(() => {
    if (product) {
      return {
        name: product.name,
        category_uuid: product.category_uuid || "",
        sku: product.sku || "",
        barcode: product.barcode || "",
        unit: product.unit || "piece",
        cost_price: product.cost_price || "0",
        sale_price: product.sale_price || "0",
        vat_rate: product.vat_rate || "20",
        currency: product.currency || "TRY",
        stock_quantity: product.stock_quantity || "0",
        min_stock_alert: product.min_stock_alert || "0",
        track_stock: product.track_stock,
        is_active: product.is_active,
        description: product.description || "",
      };
    }
    return {
      name: "",
      category_uuid: "",
      sku: "",
      barcode: "",
      unit: "piece",
      cost_price: "0",
      sale_price: "0",
      vat_rate: "20",
      currency: "TRY",
      stock_quantity: "0",
      min_stock_alert: "0",
      track_stock: true,
      is_active: true,
      description: "",
    };
  }, [product]);

  async function onSubmit(values: z.infer<typeof schema>) {
    const categoryUUID = values.category_uuid ? values.category_uuid : null;
    const body = {
      name: values.name,
      category_uuid: categoryUUID,
      sku: values.sku,
      barcode: values.barcode,
      unit: values.unit,
      cost_price: values.cost_price,
      sale_price: values.sale_price,
      vat_rate: values.vat_rate,
      currency: values.currency,
      stock_quantity: values.stock_quantity,
      min_stock_alert: values.min_stock_alert,
      track_stock: values.track_stock,
      is_active: values.is_active,
      description: values.description,
    };

    if (isEdit && product) {
      await updateProduct.mutateAsync({
        uuid: product.uuid,
        body,
      });
    } else {
      await createProduct.mutateAsync(body);
    }
    onOpenChange(false);
    onSuccess?.();
  }

  const isPending = createProduct.isPending || updateProduct.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("catalog.products.edit")
              : t("catalog.products.new")}
          </DialogTitle>
          <DialogDescription>
            {t("catalog.products.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={product?.uuid || (open ? "prd-open" : "prd-closed")}
          schema={schema}
          defaultValues={defaultValues}
          onSubmit={onSubmit}
        >
          {(form) => {
            const trackStock = form.watch("track_stock");
            return (
              <>
                <FieldGroup className="gap-4">
                  <AppInput
                    name="name"
                    label={t("catalog.products.name")}
                    placeholder={t("catalog.products.name_placeholder")}
                    required
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <AppSelect
                      name="category_uuid"
                      label={t("catalog.products.category")}
                      options={categoryOptions}
                    />
                    <AppSelect
                      name="unit"
                      label={t("catalog.products.unit")}
                      options={unitOptions}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <AppInput
                      name="sku"
                      label={t("catalog.products.sku")}
                      placeholder="Örn. CL-500"
                    />
                    <AppInput
                      name="barcode"
                      label={t("catalog.products.barcode")}
                      placeholder="Örn. 869000000000"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <AppInput
                      name="cost_price"
                      label={t("catalog.products.cost_price")}
                      type="number"
                      step="any"
                    />
                    <AppInput
                      name="sale_price"
                      label={t("catalog.products.sale_price")}
                      type="number"
                      step="any"
                    />
                    <AppInput
                      name="vat_rate"
                      label={t("catalog.products.vat_rate")}
                      type="number"
                      step="any"
                    />
                  </div>

                  <div className="rounded-lg border p-4 space-y-4 bg-muted/20">
                    <AppSwitch
                      name="track_stock"
                      label={t("catalog.products.track_stock")}
                    />

                    {trackStock && (
                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <AppInput
                          name="stock_quantity"
                          label={t("catalog.products.stock_quantity")}
                          type="number"
                          step="any"
                        />
                        <AppInput
                          name="min_stock_alert"
                          label={t("catalog.products.min_stock_alert")}
                          type="number"
                          step="any"
                        />
                      </div>
                    )}
                  </div>

                  <AppSwitch
                    name="is_active"
                    label={t("catalog.products.is_active")}
                  />

                  <AppTextarea
                    name="description"
                    label={t("catalog.products.description_field")}
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
                  <Button type="submit" disabled={isPending}>
                    {isPending ? t("common.saving") : t("common.save")}
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
