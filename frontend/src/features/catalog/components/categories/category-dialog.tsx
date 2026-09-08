"use client";

import { useMemo } from "react";
import { z } from "zod";

import { AppForm, AppInput, AppSelect, AppSwitch } from "@/components/forms";
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
import type { CatalogCategory } from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";

type CategoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultKind?: "product" | "service";
  category?: CatalogCategory | null;
  onSuccess?: () => void;
};

export function CategoryDialog({
  open,
  onOpenChange,
  defaultKind = "product",
  category,
  onSuccess,
}: CategoryDialogProps) {
  const { t } = useLocale();
  const isEdit = Boolean(category);
  const { createCategory, updateCategory } = useCatalogMutations();

  const { data: allCategories } = useCatalogCategories({
    is_active: "true",
  });

  const kindOptions = useMemo(
    () => [
      { value: "product", label: t("catalog.categories.kind_product") },
      { value: "service", label: t("catalog.categories.kind_service") },
    ],
    [t],
  );

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        kind: z.enum(["product", "service"]),
        parent_uuid: z.string().optional(),
        sort_order: z.coerce.number().default(0),
        is_active: z.boolean().default(true),
      }),
    [t],
  );

  const defaultValues = useMemo(() => {
    if (category) {
      return {
        name: category.name,
        kind: category.kind,
        parent_uuid: category.parent_uuid || "",
        sort_order: category.sort_order,
        is_active: category.is_active,
      };
    }
    return {
      name: "",
      kind: defaultKind,
      parent_uuid: "",
      sort_order: 0,
      is_active: true,
    };
  }, [category, defaultKind]);

  async function onSubmit(values: z.infer<typeof schema>) {
    const parentUUID = values.parent_uuid ? values.parent_uuid : null;
    if (isEdit && category) {
      await updateCategory.mutateAsync({
        uuid: category.uuid,
        body: {
          name: values.name,
          kind: values.kind,
          parent_uuid: parentUUID,
          sort_order: values.sort_order,
          is_active: values.is_active,
        },
      });
    } else {
      await createCategory.mutateAsync({
        name: values.name,
        kind: values.kind,
        parent_uuid: parentUUID,
        sort_order: values.sort_order,
        is_active: values.is_active,
      });
    }
    onOpenChange(false);
    onSuccess?.();
  }

  const isPending = createCategory.isPending || updateCategory.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("catalog.categories.edit")
              : t("catalog.categories.new")}
          </DialogTitle>
          <DialogDescription>
            {t("catalog.categories.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={category?.uuid || (open ? `cat-${defaultKind}-open` : "cat-closed")}
          schema={schema}
          defaultValues={defaultValues}
          onSubmit={onSubmit}
        >
          {(form) => {
            const selectedKind = form.watch("kind");
            const parentOptions = [
              { value: "", label: "— Üst Kategori Yok —" },
              ...(allCategories?.items || [])
                .filter(
                  (c) =>
                    c.kind === selectedKind &&
                    (!category || c.uuid !== category.uuid),
                )
                .map((c) => ({ value: c.uuid, label: c.name })),
            ];

            return (
              <>
                <FieldGroup className="gap-4">
                  <AppInput
                    name="name"
                    label={t("catalog.categories.name")}
                    placeholder="Örn. Şampuanlar"
                    required
                  />

                  <AppSelect
                    name="kind"
                    label={t("catalog.categories.kind")}
                    options={kindOptions}
                  />

                  <AppSelect
                    name="parent_uuid"
                    label={t("catalog.categories.parent")}
                    options={parentOptions}
                  />

                  <AppInput
                    name="sort_order"
                    label={t("catalog.categories.sort_order")}
                    type="number"
                  />

                  <AppSwitch
                    name="is_active"
                    label={t("catalog.categories.is_active")}
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
