"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { routes } from "@/config/routes";
import {
  useLandingContent,
  useLandingPlans,
} from "@/features/landing/components/landing-content-provider";
import { fill, type PublicPlan } from "@/features/landing/content";
import { cn } from "@/lib/utils";

type Period = "monthly" | "yearly";
type Option = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  unitPrice: number;
};

type PricingCopy = ReturnType<typeof useLandingContent>["pricing"];

function unitFor(unit: string | undefined, c: PricingCopy) {
  const u = unit ?? "";
  return u in c.units ? c.units[u] : u;
}

function customOptions(
  plan: PublicPlan,
  locale: string,
  c: PricingCopy,
): Option[] {
  if (!plan.is_customizable) return [];
  return plan.features
    .filter(
      (f) =>
        f.min_value !== null &&
        f.max_value !== null &&
        (f.step ?? 0) > 0 &&
        f.unit_price !== null,
    )
    .map((f) => ({
      key: f.key,
      label: (locale === "en" ? f.label_en : f.label_tr) || f.key,
      unit: unitFor(f.unit, c),
      min: f.min_value as number,
      max: f.max_value as number,
      step: f.step as number,
      unitPrice: Number.parseFloat(f.unit_price as string) || 0,
    }));
}

/** Same rule as the billing engine: base + chosen steps, then the yearly rule. */
function priceFor(
  plan: PublicPlan,
  period: Period,
  options: Option[],
  values: Record<string, number>,
) {
  const extra = options.reduce(
    (sum, o) =>
      sum + (((values[o.key] ?? o.min) - o.min) / o.step) * o.unitPrice,
    0,
  );
  const monthly = (Number.parseFloat(plan.price_monthly) || 0) + extra;
  if (period === "monthly") return monthly;
  const rule = Number.parseFloat(plan.yearly_discount_value) || 0;
  switch (plan.yearly_pricing) {
    case "fixed":
      return (Number.parseFloat(plan.price_yearly) || 0) + extra * 12;
    case "discount_amount":
      return Math.max(0, monthly * 12 - rule);
    default:
      return Math.max(0, monthly * 12 * (1 - rule / 100));
  }
}

function featureLine(
  f: PublicPlan["features"][number],
  locale: string,
  c: PricingCopy,
) {
  const label = (locale === "en" ? f.label_en : f.label_tr) || f.key;
  if (f.display_text) return { text: f.display_text, on: true };
  if (f.value_bool !== null && f.value_bool !== undefined)
    return { text: label, on: f.value_bool };
  if (f.value_int !== null && f.value_int !== undefined) {
    return {
      text: `${label}: ${f.value_int.toLocaleString(locale === "en" ? "en-US" : "tr-TR")} ${unitFor(f.unit, c)}`.trim(),
      on: true,
    };
  }
  return { text: `${label}: ${c.unlimited}`, on: true };
}

export function Pricing() {
  const { pricing: c, productMock } = useLandingContent();
  const plans = useLandingPlans();
  const [period, setPeriod] = useState<Period>("monthly");
  const money = useMemo(
    () =>
      new Intl.NumberFormat(productMock.numberLocale, {
        style: "currency",
        currency: "TRY",
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }),
    [productMock.numberLocale],
  );

  return (
    <div className="mt-12">
      <div className="flex justify-center">
        <div
          role="radiogroup"
          aria-label={`${c.monthly} / ${c.yearly}`}
          className="bg-muted inline-flex rounded-full p-1"
        >
          {(["monthly", "yearly"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "focus-visible:ring-ring rounded-full px-5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                period === p
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "monthly" ? c.monthly : c.yearly}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div className="bg-card flex flex-col rounded-2xl border p-6">
          <p className="font-semibold">{c.trialCard.name}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {c.trialCard.description}
          </p>
          <p className="font-display mt-6 text-4xl font-semibold tracking-tight">
            {c.trialCard.price}
          </p>
          <ul className="mt-6 flex-1 space-y-2 text-sm">
            {c.trialCard.points.map((p) => (
              <li key={p} className="flex gap-2">
                <Check className="text-primary mt-0.5 size-4 shrink-0" />
                {p}
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-8 rounded-full">
            <Link href={routes.public.register}>{c.trialCard.cta}</Link>
          </Button>
        </div>

        {plans.map((plan) => (
          <PlanCard key={plan.uuid} plan={plan} period={period} money={money} />
        ))}
      </div>

      <p className="text-muted-foreground mx-auto mt-8 max-w-2xl text-center text-sm">
        {c.footnote}
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  period,
  money,
}: {
  plan: PublicPlan;
  period: Period;
  money: Intl.NumberFormat;
}) {
  const { pricing: c, locale } = useLandingContent();
  const options = useMemo(
    () => customOptions(plan, locale, c),
    [plan, locale, c],
  );
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(options.map((o) => [o.key, o.min])),
  );
  const price = priceFor(plan, period, options, values);
  const saving =
    period === "yearly" &&
    plan.yearly_pricing !== "fixed" &&
    Number.parseFloat(plan.yearly_discount_value) > 0
      ? fill(c.yearlySaving, {
          value:
            plan.yearly_pricing === "discount_percent"
              ? locale === "en"
                ? `${plan.yearly_discount_value.replace(/\.00$/, "")}%`
                : `%${plan.yearly_discount_value.replace(/\.00$/, "")}`
              : money.format(Number.parseFloat(plan.yearly_discount_value)),
        })
      : null;
  const configurable = new Set(options.map((o) => o.key));
  const lines = plan.features
    .filter((f) => !configurable.has(f.key))
    .map((f) => ({ key: f.key, ...featureLine(f, locale, c) }));
  const copy = c.plans[plan.code] ?? {};
  const badge = plan.badge ? (copy.badge ?? plan.badge) : "";
  const description = copy.description ?? plan.description;
  const highlighted = Boolean(badge);

  return (
    <div
      className={cn(
        "bg-card relative flex flex-col rounded-2xl border p-6",
        highlighted && "border-primary ring-primary/15 ring-4",
        options.length > 0 && "md:col-span-2 lg:col-span-1",
      )}
    >
      {badge ? (
        <span className="bg-primary text-primary-foreground absolute -top-3 left-6 rounded-full px-3 py-1 text-xs font-medium">
          {badge}
        </span>
      ) : null}
      <p className="font-semibold">{plan.name}</p>
      {description ? (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      ) : null}
      <p className="mt-6 flex items-baseline gap-1">
        <span className="font-display text-4xl font-semibold tracking-tight tabular-nums">
          {money.format(price)}
        </span>
        <span className="text-muted-foreground text-sm">
          {period === "monthly" ? c.perMonth : c.perYear}
        </span>
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        {c.vatIncluded}
        {saving ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            {" "}
            · {saving}
          </span>
        ) : null}
      </p>

      {options.length > 0 ? (
        <div className="bg-muted/50 mt-6 space-y-5 rounded-xl p-4">
          <div>
            <p className="text-sm font-medium">{c.configure}</p>
            <p className="text-muted-foreground text-xs">{c.configureHint}</p>
          </div>
          {options.map((o) => (
            <div key={o.key} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <label htmlFor={`cfg-${plan.uuid}-${o.key}`}>{o.label}</label>
                <span className="font-medium tabular-nums">
                  {(values[o.key] ?? o.min).toLocaleString(
                    locale === "en" ? "en-US" : "tr-TR",
                  )}{" "}
                  {o.unit}
                </span>
              </div>
              <Slider
                id={`cfg-${plan.uuid}-${o.key}`}
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
                {fill(c.stepPrice, {
                  step: o.step,
                  unit: o.unit,
                  price: money.format(o.unitPrice),
                })
                  .replace(/\s+/g, " ")
                  .trim()}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <ul className="mt-6 flex-1 space-y-2 text-sm">
        {lines.map((l) => (
          <li
            key={l.key}
            className={cn("flex gap-2", !l.on && "text-muted-foreground")}
          >
            {l.on ? (
              <Check className="text-primary mt-0.5 size-4 shrink-0" />
            ) : (
              <Minus className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {l.text}
              {!l.on ? (
                <span className="sr-only"> ({c.notIncluded})</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <Button
        asChild
        variant={highlighted ? "default" : "outline"}
        className="mt-8 rounded-full"
      >
        <Link
          href={`${routes.public.register}?plan=${encodeURIComponent(plan.code)}`}
        >
          {c.choose}
        </Link>
      </Button>
    </div>
  );
}
