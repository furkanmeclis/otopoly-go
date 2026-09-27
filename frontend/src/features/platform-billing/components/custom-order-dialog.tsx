"use client";

import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { customOptions } from "@/features/billing/lib";
import type { SubscriptionPeriod } from "@/features/billing/types";
import { loadOrganizations } from "@/features/platform-billing/components/subscription-dialog";
import {
  useCustomOrderMutation,
  usePlatformPlans,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";

export function CustomOrderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {open ? <Body onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { t, locale } = useLocale();
  const plans = usePlatformPlans(true);
  const create = useCustomOrderMutation();
  const [orgUuid, setOrgUuid] = useState("");
  const [planUuid, setPlanUuid] = useState("");
  const [period, setPeriod] = useState<SubscriptionPeriod>("yearly");
  const [values, setValues] = useState<Record<string, number>>({});
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const plan = plans.data?.find((p) => p.uuid === planUuid);
  const options = plan ? customOptions(plan, locale) : [];
  const paidPlans = (plans.data ?? []).filter((p) => p.code !== "trial");

  const submit = async () => {
    setError(null);
    if (!orgUuid || !planUuid || !(Number(price) > 0))
      return setError(t("billing.validation.required"));
    const custom: Record<string, number> = {};
    for (const o of options) custom[o.key] = values[o.key] ?? o.min;
    try {
      await create.mutateAsync({
        organization_uuid: orgUuid,
        plan_uuid: planUuid,
        period,
        custom_features: options.length ? custom : undefined,
        list_price: String(Number(price)),
        note: note.trim(),
      });
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err)) setError(err.message);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("billing.custom_order.title")}</DialogTitle>
        <DialogDescription>
          {t("billing.custom_order.description")}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.subs.organization")}</Label>
          <AsyncCombobox
            value={orgUuid}
            onValueChange={setOrgUuid}
            loadOptions={loadOrganizations}
            placeholder={t("billing.subs.organization")}
            searchPlaceholder={t("billing.subs.organization_search")}
          />
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.subs.plan")}</Label>
          <Select value={planUuid} onValueChange={setPlanUuid}>
            <SelectTrigger>
              <SelectValue placeholder={t("billing.subs.plan")} />
            </SelectTrigger>
            <SelectContent>
              {paidPlans.map((p) => (
                <SelectItem key={p.uuid} value={p.uuid}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.subs.period")}</Label>
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as SubscriptionPeriod)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">
                {t("billing.period.monthly")}
              </SelectItem>
              <SelectItem value="yearly">
                {t("billing.period.yearly")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {options.map((o) => (
          <div key={o.key}>
            <Label className="mb-1 block">
              {o.label} ({o.min}–{o.max})
            </Label>
            <Input
              type="number"
              min={o.min}
              max={o.max}
              step={o.step}
              value={values[o.key] ?? o.min}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  [o.key]: Number(e.target.value) || o.min,
                }))
              }
            />
          </div>
        ))}
        <div className="sm:col-span-2">
          <Label className="mb-1 block">
            {t("billing.custom_order.price")}
          </Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.subs.note")}</Label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error ? (
          <p className="text-destructive text-sm sm:col-span-2">{error}</p>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t("billing.admin.plan.cancel")}
        </Button>
        <Button onClick={submit} disabled={create.isPending}>
          {t("billing.custom_order.create")}
        </Button>
      </DialogFooter>
    </>
  );
}
