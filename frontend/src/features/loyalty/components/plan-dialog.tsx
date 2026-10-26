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
import { EligibilityPicker } from "@/features/loyalty/components/eligibility-picker";
import { useLoyaltyMutations } from "@/features/loyalty/hooks/use-loyalty";
import type {
  LoyaltyPlan,
  PlanInput,
} from "@/features/loyalty/services/loyalty.service";
import { useLocale } from "@/providers/locale-provider";

const PERIODS = ["1", "3", "6", "12"];

export function PlanDialog({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: LoyaltyPlan | null;
}) {
  const { t } = useLocale();
  const { createPlan, updatePlan } = useLoyaltyMutations();

  const schema = useMemo(
    () =>
      z
        .object({
          name: z.string().trim().min(1, t("form.required")),
          description: z.string().optional(),
          price: z
            .string()
            .refine(
              (v) => Number(v.replace(",", ".")) > 0,
              t("loyalty.validation.price"),
            ),
          period_months: z.string(),
          uses_per_period: z.string().optional(),
          service_uuids: z.array(z.string()),
          category_uuids: z.array(z.string()),
          is_active: z.boolean(),
        })
        .superRefine((v, ctx) => {
          if (!v.service_uuids.length && !v.category_uuids.length) {
            ctx.addIssue({
              code: "custom",
              path: ["service_uuids"],
              message: t("loyalty.validation.eligibility"),
            });
          }
        }),
    [t],
  );
  type Values = z.infer<typeof schema>;

  const defaults: Values = {
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    price: plan?.price ?? "",
    period_months: String(plan?.period_months ?? 1),
    uses_per_period: plan?.uses_per_period ? String(plan.uses_per_period) : "",
    service_uuids: plan?.services.map((s) => s.uuid) ?? [],
    category_uuids: plan?.categories.map((c) => c.uuid) ?? [],
    is_active: plan?.is_active ?? true,
  };

  async function onSubmit(v: Values) {
    const body: PlanInput = {
      name: v.name.trim(),
      description: v.description?.trim() ?? "",
      price: v.price.replace(",", "."),
      period_months: Number(v.period_months),
      uses_per_period: v.uses_per_period ? Number(v.uses_per_period) : null,
      service_uuids: v.service_uuids,
      category_uuids: v.category_uuids,
      is_active: v.is_active,
    };
    if (plan) await updatePlan.mutateAsync({ uuid: plan.uuid, body });
    else await createPlan.mutateAsync(body);
    onOpenChange(false);
  }

  const pending = createPlan.isPending || updatePlan.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {plan ? t("loyalty.plans.edit") : t("loyalty.plans.new")}
          </DialogTitle>
          <DialogDescription>{t("loyalty.plans.form_hint")}</DialogDescription>
        </DialogHeader>
        <AppForm
          key={plan?.uuid ?? (open ? "plan-new" : "plan-closed")}
          schema={schema}
          defaultValues={defaults}
          onSubmit={onSubmit}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="name"
              label={t("loyalty.fields.name")}
              placeholder={t("loyalty.plans.name_placeholder")}
              required
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <AppInput
                name="price"
                type="number"
                step="any"
                label={t("loyalty.fields.price_per_period")}
                required
              />
              <AppSelect
                name="period_months"
                label={t("loyalty.fields.period")}
                options={PERIODS.map((value) => ({
                  value,
                  label: t("loyalty.period.months", { count: Number(value) }),
                }))}
              />
              <AppInput
                name="uses_per_period"
                type="number"
                label={t("loyalty.fields.uses_per_period")}
                placeholder={t("loyalty.fields.unlimited")}
              />
            </div>
            <EligibilityPicker />
            <AppSwitch name="is_active" label={t("loyalty.fields.is_active")} />
            <AppTextarea
              name="description"
              label={t("loyalty.fields.description")}
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
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
