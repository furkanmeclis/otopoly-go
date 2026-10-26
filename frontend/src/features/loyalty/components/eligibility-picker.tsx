"use client";

import { X } from "lucide-react";
import { useMemo } from "react";
import { Controller, useFormContext } from "react-hook-form";

import { FormFieldShell } from "@/components/forms/form-field";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useCatalogCategories,
  useCatalogServices,
} from "@/features/catalog/hooks/use-catalog-queries";
import { useLocale } from "@/providers/locale-provider";

/** Service options of the organization (active services). */
export function useServiceOptions() {
  const services = useCatalogServices({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  return useMemo(
    () =>
      (services.data?.items ?? []).map((s) => ({
        value: s.uuid,
        label: s.name,
        price: s.price,
        currency: s.currency,
      })),
    [services.data?.items],
  );
}

function ChipPicker({
  value,
  onChange,
  options,
  placeholder,
  empty,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  empty: string;
}) {
  const { t } = useLocale();
  const byValue = new Map(options.map((o) => [o.value, o.label]));
  return (
    <div className="space-y-2">
      <AsyncCombobox
        value=""
        onValueChange={(v) => {
          if (v && !value.includes(v)) onChange([...value, v]);
        }}
        options={options}
        selectedValues={value}
        hideSelected
        placeholder={placeholder}
        emptyText={empty}
      />
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pe-1">
              {byValue.get(v) ?? "…"}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-4 rounded-full"
                aria-label={t("loyalty.actions.remove")}
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <X className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Form-bound eligible services + service categories (`service_uuids`,
 * `category_uuids`). At least one is validated by the parent schema.
 */
export function EligibilityPicker() {
  const { t } = useLocale();
  const {
    control,
    formState: { errors },
  } = useFormContext<{ service_uuids: string[]; category_uuids: string[] }>();
  const serviceOptions = useServiceOptions();
  const categories = useCatalogCategories({
    kind: "service",
    is_active: "true",
  });
  const categoryOptions = useMemo(
    () =>
      (categories.data?.items ?? []).map((c) => ({
        value: c.uuid,
        label: c.name,
      })),
    [categories.data?.items],
  );
  const error = (errors.service_uuids?.message ??
    errors.category_uuids?.message) as string | undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormFieldShell
        name="service_uuids"
        label={t("loyalty.fields.services")}
        description={t("loyalty.fields.services_hint")}
        error={error}
      >
        <Controller
          name="service_uuids"
          control={control}
          render={({ field }) => (
            <ChipPicker
              value={field.value ?? []}
              onChange={field.onChange}
              options={serviceOptions}
              placeholder={t("loyalty.fields.pick_service")}
              empty={t("loyalty.fields.no_services")}
            />
          )}
        />
      </FormFieldShell>
      <FormFieldShell
        name="category_uuids"
        label={t("loyalty.fields.categories")}
        description={t("loyalty.fields.categories_hint")}
      >
        <Controller
          name="category_uuids"
          control={control}
          render={({ field }) => (
            <ChipPicker
              value={field.value ?? []}
              onChange={field.onChange}
              options={categoryOptions}
              placeholder={t("loyalty.fields.pick_category")}
              empty={t("loyalty.fields.no_categories")}
            />
          )}
        />
      </FormFieldShell>
    </div>
  );
}
