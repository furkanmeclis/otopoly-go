"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
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
import type {
  DiscountCode,
  DiscountCodeInput,
  DiscountKind,
  SubscriptionPeriod,
} from "@/features/billing/types";
import {
  usePlatformDiscountMutations,
  usePlatformPlans,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";

const CODE_RE = /^[A-Z0-9_-]{3,40}$/;
const PERIODS: SubscriptionPeriod[] = ["monthly", "yearly"];
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const startOfDay = (day: string) => (day ? `${day}T00:00:00+03:00` : null);
const endOfDay = (day: string) => (day ? `${day}T23:59:59+03:00` : null);
const intOrNull = (v: string) =>
  v.trim() === "" ? null : Math.max(1, Math.floor(Number(v)) || 1);

function initial(code: DiscountCode | null): DiscountCodeInput {
  if (code) {
    const { uuid: _u, used_count: _c, created_at: _d, ...rest } = code;
    return rest;
  }
  return {
    code: "",
    kind: "percent",
    value: "10",
    plan_uuids: [],
    periods: [],
    starts_at: null,
    ends_at: null,
    max_uses: null,
    max_uses_per_org: 1,
    first_purchase_only: false,
    is_active: true,
    note: "",
  };
}

export function DiscountCodeDialog({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: DiscountCode | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {open ? <Body code={code} onOpenChange={onOpenChange} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  code,
  onOpenChange,
}: {
  code: DiscountCode | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const plans = usePlatformPlans(true);
  const { create, update } = usePlatformDiscountMutations();
  const [form, setForm] = useState<DiscountCodeInput>(() => initial(code));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DiscountCodeInput>(
    k: K,
    v: DiscountCodeInput[K],
  ) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = <T extends string>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setError(null);
    const value = Number(form.value);
    if (!CODE_RE.test(form.code)) return setError(t("billing.validation.code"));
    if (!(value > 0) || (form.kind === "percent" && value > 100))
      return setError(t("billing.validation.number"));
    const body = { ...form, value: String(value), note: form.note.trim() };
    try {
      if (code) await update.mutateAsync({ uuid: code.uuid, body });
      else await create.mutateAsync(body);
      onOpenChange(false);
    } catch (err) {
      if (isApiError(err)) setError(err.message);
    }
  };

  const paidPlans = (plans.data ?? []).filter((p) => p.code !== "trial");

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {code ? t("billing.discounts.edit") : t("billing.discounts.new")}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.discounts.code")}</Label>
          <Input
            className="font-mono uppercase"
            value={form.code}
            onChange={(e) =>
              set("code", e.target.value.toUpperCase().replace(/\s+/g, ""))
            }
          />
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.discounts.kind")}</Label>
          <Select
            value={form.kind}
            onValueChange={(v) => set("kind", v as DiscountKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">
                {t("billing.discounts.kind.percent")}
              </SelectItem>
              <SelectItem value="amount">
                {t("billing.discounts.kind.amount")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.discounts.value")}</Label>
          <Input
            type="number"
            min={0}
            step="any"
            value={form.value}
            onChange={(e) => set("value", e.target.value)}
          />
        </div>
        <fieldset className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.discounts.plans")}</Label>
          <div className="flex flex-wrap gap-3">
            {paidPlans.map((p) => (
              <label key={p.uuid} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.plan_uuids.includes(p.uuid)}
                  onCheckedChange={() =>
                    set("plan_uuids", toggle(form.plan_uuids, p.uuid))
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.discounts.periods")}</Label>
          <div className="flex gap-4">
            {PERIODS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.periods.includes(p)}
                  onCheckedChange={() =>
                    set("periods", toggle(form.periods, p))
                  }
                />
                {t(`billing.period.${p}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Label className="mb-1 block">
            {t("billing.discounts.starts_at")}
          </Label>
          <DatePicker
            value={dayOf(form.starts_at)}
            onChange={(v) => set("starts_at", startOfDay(v))}
          />
        </div>
        <div>
          <Label className="mb-1 block">{t("billing.discounts.ends_at")}</Label>
          <DatePicker
            value={dayOf(form.ends_at)}
            onChange={(v) => set("ends_at", endOfDay(v))}
          />
        </div>
        <div>
          <Label className="mb-1 block">
            {t("billing.discounts.max_uses")}
          </Label>
          <Input
            type="number"
            min={1}
            placeholder={t("billing.discounts.unlimited")}
            value={form.max_uses ?? ""}
            onChange={(e) => set("max_uses", intOrNull(e.target.value))}
          />
        </div>
        <div>
          <Label className="mb-1 block">
            {t("billing.discounts.max_uses_per_org")}
          </Label>
          <Input
            type="number"
            min={1}
            placeholder={t("billing.discounts.unlimited")}
            value={form.max_uses_per_org ?? ""}
            onChange={(e) => set("max_uses_per_org", intOrNull(e.target.value))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.first_purchase_only}
            onCheckedChange={(v) => set("first_purchase_only", v)}
          />
          {t("billing.discounts.first_purchase_only")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.is_active}
            onCheckedChange={(v) => set("is_active", v)}
          />
          {t("billing.discounts.active")}
        </label>
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.discounts.note")}</Label>
          <Textarea
            rows={2}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
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
        <Button onClick={submit} disabled={pending}>
          {t("billing.admin.plan.save")}
        </Button>
      </DialogFooter>
    </>
  );
}
