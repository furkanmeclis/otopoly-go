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
import { ServiceColorField } from "@/features/catalog/components/services/service-color-field";
import { useCatalogMutations } from "@/features/catalog/hooks/use-catalog-mutations";
import { useCatalogCategories } from "@/features/catalog/hooks/use-catalog-queries";
import type { CatalogService } from "@/features/catalog/services/catalog.service";
import { useLocale } from "@/providers/locale-provider";

type ServiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service?: CatalogService | null;
  onSuccess?: () => void;
};

export function ServiceDialog({
  open,
  onOpenChange,
  service,
  onSuccess,
}: ServiceDialogProps) {
  const { t } = useLocale();
  const isEdit = Boolean(service);
  const { createService, updateService } = useCatalogMutations();

  const { data: categories } = useCatalogCategories({
    kind: "service",
    is_active: "true",
  });

  const categoryOptions = useMemo(
    () => [
      { value: "", label: `— ${t("catalog.services.category_select")} —` },
      ...(categories?.items || []).map((c) => ({
        value: c.uuid,
        label: c.name,
      })),
    ],
    [categories, t],
  );

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        category_uuid: z.string().optional(),
        code: z.string().optional(),
        duration_minutes: z.coerce.number().min(1).default(30),
        price: z.string().default("0"),
        vat_rate: z.string().default("20"),
        currency: z.string().default("TRY"),
        is_active: z.boolean().default(true),
        description: z.string().optional(),
        color: z.string().default(""),
      }),
    [t],
  );

  const defaultValues = useMemo(() => {
    if (service) {
      return {
        name: service.name,
        category_uuid: service.category_uuid || "",
        code: service.code || "",
        duration_minutes: service.duration_minutes,
        price: service.price || "0",
        vat_rate: service.vat_rate || "20",
        currency: service.currency || "TRY",
        is_active: service.is_active,
        description: service.description || "",
        color: service.color || "",
      };
    }
    return {
      name: "",
      category_uuid: "",
      code: "",
      duration_minutes: 30,
      price: "0",
      vat_rate: "20",
      currency: "TRY",
      is_active: true,
      description: "",
      color: "",
    };
  }, [service]);

  async function onSubmit(values: z.infer<typeof schema>) {
    const categoryUUID = values.category_uuid ? values.category_uuid : null;
    const body = {
      name: values.name,
      category_uuid: categoryUUID,
      code: values.code,
      duration_minutes: values.duration_minutes,
      price: values.price,
      vat_rate: values.vat_rate,
      currency: values.currency,
      is_active: values.is_active,
      description: values.description,
      color: values.color,
    };

    if (isEdit && service) {
      await updateService.mutateAsync({
        uuid: service.uuid,
        body,
      });
    } else {
      await createService.mutateAsync(body);
    }
    onOpenChange(false);
    onSuccess?.();
  }

  const isPending = createService.isPending || updateService.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("catalog.services.edit") : t("catalog.services.new")}
          </DialogTitle>
          <DialogDescription>
            {t("catalog.services.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={service?.uuid || (open ? "svc-open" : "svc-closed")}
          schema={schema}
          defaultValues={defaultValues}
          onSubmit={onSubmit}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="name"
              label={t("catalog.services.name")}
              placeholder={t("catalog.services.name_placeholder")}
              required
            />

            <div className="grid grid-cols-2 gap-4">
              <AppSelect
                name="category_uuid"
                label={t("catalog.services.category")}
                options={categoryOptions}
              />
              <AppInput
                name="code"
                label={t("catalog.services.code")}
                placeholder={t("catalog.placeholders.service_code")}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <AppInput
                name="duration_minutes"
                label={t("catalog.services.duration")}
                type="number"
              />
              <AppInput
                name="price"
                label={t("catalog.services.price")}
                type="number"
                step="any"
              />
              <AppInput
                name="vat_rate"
                label={t("catalog.services.vat_rate")}
                type="number"
                step="any"
              />
            </div>

            <ServiceColorField />

            <AppSwitch
              name="is_active"
              label={t("catalog.services.is_active")}
            />

            <AppTextarea
              name="description"
              label={t("catalog.services.description_field")}
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
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
