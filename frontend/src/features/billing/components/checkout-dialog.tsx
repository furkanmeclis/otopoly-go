"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BankInstructions } from "@/features/billing/components/bank-instructions";
import { QuoteLines } from "@/features/billing/components/quote-lines";
import {
  useBillingOrderMutations,
  useOrderPreview,
} from "@/features/billing/hooks/use-billing";
import type {
  BillingOrder,
  BillingPlan,
  SubscriptionPeriod,
} from "@/features/billing/types";
import { customOptions } from "@/features/billing/lib";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { isApiError } from "@/lib/api";
import { date } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type CheckoutDialogProps = {
  plan: BillingPlan | null;
  defaultPeriod: SubscriptionPeriod;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CheckoutDialog(props: CheckoutDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {props.open && props.plan ? (
          <CheckoutBody {...props} plan={props.plan} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CheckoutBody({
  plan,
  defaultPeriod,
  onOpenChange,
}: CheckoutDialogProps & { plan: BillingPlan }) {
  const { t, locale } = useLocale();
  const [period, setPeriod] = useState<SubscriptionPeriod>(defaultPeriod);
  const [codeInput, setCodeInput] = useState("");
  const [code, setCode] = useState("");
  const [order, setOrder] = useState<BillingOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = customOptions(plan, locale);
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(options.map((o) => [o.key, o.min])),
  );
  const debouncedValues = useDebounced(values, 350);
  const custom = options.length ? debouncedValues : undefined;
  const preview = useOrderPreview({
    plan_uuid: plan.uuid,
    period,
    discount_code: code || undefined,
    custom_features: custom,
  });
  const { create } = useBillingOrderMutations();
  const q = preview.data;

  const submit = async () => {
    setError(null);
    try {
      const created = await create.mutateAsync({
        plan_uuid: plan.uuid,
        period,
        discount_code: code || undefined,
        custom_features: options.length ? values : undefined,
      });
      setOrder(created);
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === "ORDER_OPEN") setError(t("billing.error.order_open"));
        else if (err.code === "PLAN_UNAVAILABLE")
          setError(t("billing.error.plan_unavailable"));
        else setError(err.message);
      }
    }
  };

  if (order) {
    const done = order.status === "approved";
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {done
              ? t("billing.checkout.free_done_title")
              : t("billing.bank.title")}
          </DialogTitle>
          {done ? (
            <DialogDescription>
              {t("billing.checkout.free_done_body")}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {done ? (
          <div className="flex justify-center py-6">
            <CheckCircle2 className="size-14 text-emerald-500" />
          </div>
        ) : order.instructions ? (
          <BankInstructions
            instructions={order.instructions}
            expiresAt={order.expires_at}
          />
        ) : null}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {t("billing.checkout.done")}
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("billing.checkout.title")}</DialogTitle>
        <DialogDescription>
          {plan.name}
          {q ? ` · ${t(`billing.checkout.kind.${q.kind}`)}` : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label>{t("billing.checkout.period")}</Label>
          <Tabs
            value={period}
            onValueChange={(v) => setPeriod(v as SubscriptionPeriod)}
          >
            <TabsList>
              <TabsTrigger value="monthly">
                {t("billing.period.monthly")}
              </TabsTrigger>
              <TabsTrigger value="yearly">
                {t("billing.period.yearly")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div>
          <Label htmlFor="discount-code" className="mb-1 block">
            {t("billing.checkout.discount_code")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="discount-code"
              value={codeInput}
              placeholder={t("billing.checkout.discount_placeholder")}
              className="font-mono uppercase"
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") setCode(codeInput.trim());
              }}
            />
            {code ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCode("");
                  setCodeInput("");
                }}
              >
                {t("billing.checkout.remove_code")}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={!codeInput.trim()}
                onClick={() => setCode(codeInput.trim())}
              >
                {t("billing.checkout.apply")}
              </Button>
            )}
          </div>
          {q?.discount_error ? (
            <p className="text-destructive mt-1 text-xs">
              {q.discount_error.message}
            </p>
          ) : null}
        </div>
        {options.length ? (
          <div className="space-y-4 rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("billing.custom.title")}</p>
              <p className="text-muted-foreground text-xs">
                {t("billing.custom.hint")}
              </p>
            </div>
            {options.map((o) => (
              <div key={o.key} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <Label htmlFor={`custom-${o.key}`}>{o.label}</Label>
                  <span className="font-medium tabular-nums">
                    {formatQuantity(values[o.key] ?? o.min, locale)} {o.unit}
                  </span>
                </div>
                <Slider
                  id={`custom-${o.key}`}
                  min={o.min}
                  max={o.max}
                  step={o.step}
                  value={[values[o.key] ?? o.min]}
                  onValueChange={([v]) =>
                    setValues((prev) => ({ ...prev, [o.key]: v }))
                  }
                  aria-label={o.label}
                />
                <p className="text-muted-foreground text-[11px]">
                  {t("billing.custom.per_step", {
                    step: o.step,
                    unit: o.unit,
                    price: formatFinanceAmount(o.unitPrice, "TRY", locale),
                  })}
                </p>
              </div>
            ))}
          </div>
        ) : null}
        {preview.isLoading || !q ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <QuoteLines
              lines={q.lines}
              total={q.total}
              vatRate={q.vat_rate}
              vatAmount={q.vat_amount}
            />
            <p className="text-muted-foreground text-xs">
              {t("billing.checkout.period_dates", {
                start: date(q.starts_at, "dd.MM.yyyy", locale),
                end: date(q.ends_at, "dd.MM.yyyy", locale),
              })}
            </p>
            {Number.parseFloat(q.credit_surplus) > 0 ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("billing.checkout.credit_surplus", {
                  amount: formatFinanceAmount(q.credit_surplus, "TRY", locale),
                })}
              </p>
            ) : null}
          </>
        )}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t("billing.admin.plan.cancel")}
        </Button>
        <Button
          onClick={submit}
          disabled={!q || create.isPending || Boolean(q?.discount_error)}
        >
          {create.isPending
            ? t("billing.checkout.creating")
            : t("billing.checkout.create")}
        </Button>
      </DialogFooter>
    </>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(h);
  }, [value, ms]);
  return v;
}
