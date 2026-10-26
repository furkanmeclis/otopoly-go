"use client";

import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { AppForm, AppInput, AppSwitch, AppTextarea } from "@/components/forms";
import { FormFieldShell } from "@/components/forms/form-field";
import { AsyncCombobox } from "@/components/ui/async-combobox";
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
import { Input } from "@/components/ui/input";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { useServiceOptions } from "@/features/loyalty/components/eligibility-picker";
import { useLoyaltyMutations } from "@/features/loyalty/hooks/use-loyalty";
import type {
  LoyaltyPackage,
  PackageInput,
} from "@/features/loyalty/services/loyalty.service";
import { useLocale } from "@/providers/locale-provider";

type Item = { service_uuid: string; quantity: number };

export function PackageDialog({
  open,
  onOpenChange,
  pkg,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pkg?: LoyaltyPackage | null;
}) {
  const { t } = useLocale();
  const { createPackage, updatePackage } = useLoyaltyMutations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {pkg ? t("loyalty.packages.edit") : t("loyalty.packages.new")}
          </DialogTitle>
          <DialogDescription>
            {t("loyalty.packages.form_hint")}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <PackageForm
            key={pkg?.uuid ?? "package-new"}
            pkg={pkg}
            pending={createPackage.isPending || updatePackage.isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (v, items) => {
              const body: PackageInput = {
                name: v.name.trim(),
                description: v.description?.trim() ?? "",
                price: v.price.replace(",", "."),
                validity_days: v.validity_days ? Number(v.validity_days) : null,
                is_active: v.is_active,
                items,
              };
              if (pkg)
                await updatePackage.mutateAsync({ uuid: pkg.uuid, body });
              else await createPackage.mutateAsync(body);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type PackageValues = {
  name: string;
  description?: string;
  price: string;
  validity_days?: string;
  is_active: boolean;
};

function PackageForm({
  pkg,
  pending,
  onCancel,
  onSubmit,
}: {
  pkg?: LoyaltyPackage | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: PackageValues, items: Item[]) => Promise<void>;
}) {
  const { t, locale } = useLocale();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t("form.required")),
        description: z.string().optional(),
        price: z
          .string()
          .refine(
            (v) => Number(v.replace(",", ".")) > 0,
            t("loyalty.validation.price"),
          ),
        validity_days: z.string().optional(),
        is_active: z.boolean(),
      }),
    [t],
  );
  const services = useServiceOptions();
  const [items, setItems] = useState<Item[]>(
    pkg?.items.map((i) => ({
      service_uuid: i.service_uuid,
      quantity: i.quantity,
    })) ?? [],
  );
  const [itemsError, setItemsError] = useState<string>();
  const byUuid = new Map(services.map((s) => [s.value, s]));
  const listValue = items.reduce((sum, i) => {
    const s = byUuid.get(i.service_uuid);
    return sum + (s ? Number(s.price) * i.quantity : 0);
  }, 0);

  const defaults: PackageValues = {
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    price: pkg?.price ?? "",
    validity_days: pkg?.validity_days ? String(pkg.validity_days) : "",
    is_active: pkg?.is_active ?? true,
  };

  return (
    <AppForm
      schema={schema}
      defaultValues={defaults}
      onSubmit={async (v) => {
        if (!items.length || items.some((i) => !(i.quantity >= 1))) {
          setItemsError(t("loyalty.validation.items"));
          return;
        }
        setItemsError(undefined);
        await onSubmit(v, items);
      }}
    >
      <FieldGroup className="gap-4">
        <AppInput
          name="name"
          label={t("loyalty.fields.name")}
          placeholder={t("loyalty.packages.name_placeholder")}
          required
        />
        <FormFieldShell
          name="items"
          label={t("loyalty.fields.items")}
          description={t("loyalty.fields.items_hint")}
          error={itemsError}
        >
          <div className="space-y-2">
            <AsyncCombobox
              value=""
              onValueChange={(v) => {
                if (v && !items.some((i) => i.service_uuid === v)) {
                  setItems([...items, { service_uuid: v, quantity: 10 }]);
                }
              }}
              options={services.map((s) => ({
                value: s.value,
                label: s.label,
              }))}
              selectedValues={items.map((i) => i.service_uuid)}
              hideSelected
              placeholder={t("loyalty.fields.add_service")}
              emptyText={t("loyalty.fields.no_services")}
            />
            {items.length ? (
              <ul className="divide-border divide-y rounded-lg border text-sm">
                {items.map((item, idx) => {
                  const s = byUuid.get(item.service_uuid);
                  return (
                    <li
                      key={item.service_uuid}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {s?.label ??
                          pkg?.items.find(
                            (i) => i.service_uuid === item.service_uuid,
                          )?.service_name ??
                          "—"}
                      </span>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        className="h-8 w-20"
                        aria-label={t("loyalty.fields.quantity")}
                        value={item.quantity}
                        onChange={(e) => {
                          const next = [...items];
                          next[idx] = {
                            ...item,
                            quantity: Number(e.target.value),
                          };
                          setItems(next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={t("loyalty.actions.remove")}
                        onClick={() =>
                          setItems(items.filter((_, i) => i !== idx))
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {items.length ? (
              <p className="text-muted-foreground text-xs">
                {t("loyalty.packages.list_value", {
                  value: formatFinanceAmount(String(listValue), "TRY", locale),
                })}
              </p>
            ) : null}
          </div>
        </FormFieldShell>
        <div className="grid gap-4 sm:grid-cols-2">
          <AppInput
            name="price"
            type="number"
            step="any"
            label={t("loyalty.fields.price")}
            required
          />
          <AppInput
            name="validity_days"
            type="number"
            label={t("loyalty.fields.validity_days")}
            placeholder={t("loyalty.fields.no_expiry")}
          />
        </div>
        <AppSwitch name="is_active" label={t("loyalty.fields.is_active")} />
        <AppTextarea
          name="description"
          label={t("loyalty.fields.description")}
          rows={2}
        />
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </AppForm>
  );
}
