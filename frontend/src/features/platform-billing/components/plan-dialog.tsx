"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { yearlyPrice } from "@/features/billing/lib";
import type {
  BillingPlan,
  BillingPlanInput,
  YearlyPricing,
} from "@/features/billing/types";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlanFeaturesEditor } from "@/features/platform-billing/components/plan-features-editor";
import {
  usePlatformFeatures,
  usePlatformPlanMutations,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { useLocale } from "@/providers/locale-provider";

const CODE_RE = /^[a-z0-9_-]{2,32}$/;
const YEARLY: YearlyPricing[] = [
  "fixed",
  "discount_amount",
  "discount_percent",
];

type PlanDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: BillingPlan | null;
};

function initialInput(plan?: BillingPlan | null): BillingPlanInput {
  if (plan) {
    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      price_monthly: plan.price_monthly,
      yearly_pricing: plan.yearly_pricing,
      price_yearly: plan.price_yearly,
      yearly_discount_value: plan.yearly_discount_value,
      trial_days: plan.trial_days,
      is_public: plan.is_public,
      is_customizable: plan.is_customizable,
      is_active: plan.is_active,
      badge: plan.badge,
      sort_order: plan.sort_order,
      features: plan.features.map((f) => ({ ...f })),
    };
  }
  return {
    code: "",
    name: "",
    description: "",
    price_monthly: "0",
    yearly_pricing: "discount_percent",
    price_yearly: "0",
    yearly_discount_value: "10",
    trial_days: 0,
    is_public: true,
    is_customizable: false,
    is_active: true,
    badge: "",
    sort_order: 10,
    features: [],
  };
}

export function PlanDialog(props: PlanDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        {props.open ? <PlanDialogBody {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PlanDialogBody({ onOpenChange, plan }: PlanDialogProps) {
  const { t, locale } = useLocale();
  const [form, setForm] = useState<BillingPlanInput>(() => initialInput(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const features = usePlatformFeatures(true);
  const { create, update } = usePlatformPlanMutations();
  const pending = create.isPending || update.isPending;

  const set = <K extends keyof BillingPlanInput>(
    key: K,
    value: BillingPlanInput[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!CODE_RE.test(form.code)) e.code = t("billing.validation.code");
    if (!form.name.trim()) e.name = t("billing.validation.required");
    if (Number.isNaN(Number(form.price_monthly)))
      e.price_monthly = t("billing.validation.number");
    if (
      form.yearly_pricing === "fixed" &&
      Number.isNaN(Number(form.price_yearly))
    )
      e.price_yearly = t("billing.validation.number");
    if (
      form.yearly_pricing !== "fixed" &&
      Number.isNaN(Number(form.yearly_discount_value))
    )
      e.yearly_discount_value = t("billing.validation.number");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    const body: BillingPlanInput = {
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      badge: form.badge.trim(),
      price_monthly: String(Number(form.price_monthly)),
      price_yearly: String(Number(form.price_yearly) || 0),
      yearly_discount_value: String(Number(form.yearly_discount_value) || 0),
    };
    try {
      if (plan) await update.mutateAsync({ uuid: plan.uuid, body });
      else await create.mutateAsync(body);
      onOpenChange(false);
    } catch {
      /* toast via global handler */
    }
  };

  const effectiveYearly = yearlyPrice(form);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {plan ? t("billing.admin.plan.edit") : t("billing.admin.plan.new")}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-4 py-2 sm:grid-cols-2">
        <Field
          label={t("billing.admin.plan.code")}
          error={errors.code}
          hint={t("billing.admin.plan.code_hint")}
        >
          <Input
            value={form.code}
            readOnly={Boolean(plan)}
            onChange={(e) => set("code", e.target.value.trim())}
          />
        </Field>
        <Field label={t("billing.admin.plan.name")} error={errors.name}>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field
          label={t("billing.admin.plan.description")}
          className="sm:col-span-2"
        >
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field
          label={t("billing.admin.plan.price_monthly")}
          error={errors.price_monthly}
        >
          <Input
            type="number"
            min={0}
            step="any"
            value={form.price_monthly}
            onChange={(e) => set("price_monthly", e.target.value)}
          />
        </Field>
        <Field label={t("billing.admin.plan.yearly_pricing")}>
          <Select
            value={form.yearly_pricing}
            onValueChange={(v) => set("yearly_pricing", v as YearlyPricing)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARLY.map((y) => (
                <SelectItem key={y} value={y}>
                  {t(`billing.admin.plan.yearly.${y}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {form.yearly_pricing === "fixed" ? (
          <Field
            label={t("billing.admin.plan.price_yearly")}
            error={errors.price_yearly}
          >
            <Input
              type="number"
              min={0}
              step="any"
              value={form.price_yearly}
              onChange={(e) => set("price_yearly", e.target.value)}
            />
          </Field>
        ) : (
          <Field
            label={t("billing.admin.plan.yearly_discount_value")}
            error={errors.yearly_discount_value}
          >
            <Input
              type="number"
              min={0}
              step="any"
              value={form.yearly_discount_value}
              onChange={(e) => set("yearly_discount_value", e.target.value)}
            />
          </Field>
        )}
        <Field label={t("billing.admin.plan.effective_yearly")}>
          <p className="h-9 py-2 text-sm font-medium tabular-nums">
            {formatFinanceAmount(effectiveYearly, "TRY", locale)}{" "}
            {t("billing.plans.per_year")}
          </p>
        </Field>
        <Field label={t("billing.admin.plan.trial_days")}>
          <Input
            type="number"
            min={0}
            value={form.trial_days}
            onChange={(e) =>
              set("trial_days", Math.max(0, Number(e.target.value) || 0))
            }
          />
        </Field>
        <Field label={t("billing.admin.plan.badge")}>
          <Input
            value={form.badge}
            onChange={(e) => set("badge", e.target.value)}
          />
        </Field>
        <Field label={t("billing.admin.plan.sort_order")}>
          <Input
            type="number"
            value={form.sort_order}
            onChange={(e) => set("sort_order", Number(e.target.value) || 0)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:gap-6">
          <Toggle
            label={t("billing.admin.plan.is_public")}
            checked={form.is_public}
            onChange={(v) => set("is_public", v)}
          />
          <Toggle
            label={t("billing.admin.plan.is_customizable")}
            checked={form.is_customizable}
            onChange={(v) => set("is_customizable", v)}
          />
          <Toggle
            label={t("billing.admin.plan.is_active")}
            checked={form.is_active}
            onChange={(v) => set("is_active", v)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="mb-2 block">
            {t("billing.admin.plan.features")}
          </Label>
          <PlanFeaturesEditor
            features={features.data ?? []}
            values={form.features}
            onChange={(values) => set("features", values)}
            disabled={pending}
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          {t("billing.admin.plan.cancel")}
        </Button>
        <Button onClick={submit} disabled={pending}>
          {t("billing.admin.plan.save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block">{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive mt-1 text-xs">{error}</p>
      ) : hint ? (
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
