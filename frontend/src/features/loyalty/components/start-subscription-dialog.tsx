"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import {
  AppDatePicker,
  AppForm,
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
import { customersService } from "@/features/customers/services/customers.service";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { CustomerField } from "@/features/loyalty/components/customer-field";
import {
  PaymentFields,
  needsAccount,
  useDefaultAccount,
} from "@/features/loyalty/components/payment-fields";
import {
  useLoyaltyMutations,
  useLoyaltyPlans,
} from "@/features/loyalty/hooks/use-loyalty";
import type { LoyaltyPlan } from "@/features/loyalty/services/loyalty.service";
import { useLocale } from "@/providers/locale-provider";

export function StartSubscriptionDialog({
  open,
  onOpenChange,
  customerUuid,
  customerName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerUuid?: string;
  customerName?: string;
}) {
  const { t } = useLocale();
  const { startSubscription } = useLoyaltyMutations();
  const plans = useLoyaltyPlans(
    { limit: 100, offset: 0, is_active: "true" },
    open,
  );
  const { defaultUuid } = useDefaultAccount();

  const schema = useMemo(
    () =>
      z
        .object({
          customer_uuid: z.string().min(1, t("form.required")),
          plan_uuid: z.string().min(1, t("form.required")),
          vehicle_uuid: z.string().optional(),
          start_date: z.string().optional(),
          collect: z.boolean(),
          method: z.enum(["cash", "card", "cari"]),
          finance_account_uuid: z.string().optional(),
          notes: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (v.collect && needsAccount(v.method, v.finance_account_uuid)) {
            ctx.addIssue({
              code: "custom",
              path: ["finance_account_uuid"],
              message: t("loyalty.validation.finance_account"),
            });
          }
        }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("loyalty.start.title")}</DialogTitle>
          <DialogDescription>
            {customerName
              ? t("loyalty.start.description_for", { name: customerName })
              : t("loyalty.start.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={
            open ? `start-${defaultUuid}-${customerUuid ?? ""}` : "start-closed"
          }
          schema={schema}
          defaultValues={{
            customer_uuid: customerUuid ?? "",
            plan_uuid: "",
            vehicle_uuid: "",
            start_date: format(new Date(), "yyyy-MM-dd"),
            collect: true,
            method: "cash",
            finance_account_uuid: defaultUuid,
            notes: "",
          }}
          onSubmit={async (v) => {
            await startSubscription.mutateAsync({
              customer_uuid: v.customer_uuid,
              plan_uuid: v.plan_uuid,
              vehicle_uuid: v.vehicle_uuid || null,
              start_date: v.start_date || null,
              notes: v.notes?.trim() ?? "",
              payment: v.collect
                ? {
                    method: v.method,
                    finance_account_uuid:
                      v.method === "cari"
                        ? null
                        : v.finance_account_uuid || null,
                  }
                : null,
            });
            onOpenChange(false);
          }}
        >
          <StartFields
            plans={plans.data?.items ?? []}
            fixedCustomer={Boolean(customerUuid)}
          />
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={startSubscription.isPending}>
              {startSubscription.isPending
                ? t("common.saving")
                : t("loyalty.start.submit")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function StartFields({
  plans,
  fixedCustomer,
}: {
  plans: LoyaltyPlan[];
  fixedCustomer: boolean;
}) {
  const { t, locale } = useLocale();
  const form = useFormContext<{
    customer_uuid: string;
    plan_uuid: string;
    collect: boolean;
  }>();
  const customerUuid = form.watch("customer_uuid");
  const plan = plans.find((p) => p.uuid === form.watch("plan_uuid"));
  const collect = form.watch("collect");
  const customer = useQuery({
    queryKey: ["tenant", "loyalty", "customer-vehicles", customerUuid],
    queryFn: () => customersService.get(customerUuid),
    enabled: Boolean(customerUuid),
  });
  const vehicles = customer.data?.vehicles ?? [];

  return (
    <FieldGroup className="gap-4">
      {fixedCustomer ? null : <CustomerField />}
      <AppSelect
        name="plan_uuid"
        label={t("loyalty.fields.plan")}
        placeholder={t("loyalty.fields.pick_plan")}
        options={plans.map((p) => ({ value: p.uuid, label: p.name }))}
      />
      {plan ? (
        <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">
            {plan.uses_per_period
              ? t("loyalty.plans.uses_value", {
                  count: plan.uses_per_period,
                  months: plan.period_months,
                })
              : t("loyalty.plans.unlimited_value", {
                  months: plan.period_months,
                })}
          </span>
          <span className="font-semibold tabular-nums">
            {formatFinanceAmount(plan.price, plan.currency, locale)}
          </span>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <AppSelect
          name="vehicle_uuid"
          label={t("loyalty.fields.vehicle")}
          options={[
            { value: "", label: t("loyalty.fields.any_vehicle") },
            ...vehicles.map((v) => ({ value: v.uuid, label: v.plate })),
          ]}
        />
        <AppDatePicker
          name="start_date"
          label={t("loyalty.fields.start_date")}
        />
      </div>
      <AppSwitch
        name="collect"
        label={t("loyalty.fields.collect_now")}
        description={t("loyalty.fields.collect_now_hint")}
      />
      {collect ? <PaymentFields /> : null}
      <AppTextarea name="notes" label={t("loyalty.fields.notes")} rows={2} />
    </FieldGroup>
  );
}
