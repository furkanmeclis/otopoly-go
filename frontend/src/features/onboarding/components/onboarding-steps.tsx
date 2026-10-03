"use client";

import { Check } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";

import {
  AppCombobox,
  AppInput,
  AppPassword,
  AppTextarea,
} from "@/components/forms";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { OrganizationRegisterFormValues } from "@/features/auth/schemas";
import { TR_PROVINCES } from "@/features/onboarding/data/provinces";
import type { StarterService } from "@/features/onboarding/data/starter-services";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/locale-provider";

/*
 * Wizard steps shared by the public sign-up (/register) and the signed-in
 * create-business flow (/onboarding/business). Fields bind to the
 * surrounding AppForm via react-hook-form context.
 */

type Values = OrganizationRegisterFormValues;

const PROVINCE_OPTIONS = TR_PROVINCES.map((name) => ({
  value: name,
  label: name,
}));

export function BusinessStep() {
  const { t } = useLocale();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AppInput
        name="organization_name"
        label={t("register.fields.organization_name")}
        placeholder={t("register.onboarding.business.name_placeholder")}
        autoFocus
        className="sm:col-span-2"
      />
      <AppInput
        name="phone"
        type="tel"
        inputMode="tel"
        label={t("register.fields.phone")}
        placeholder="05XX XXX XX XX"
        className="sm:col-span-2"
      />
      <AppCombobox
        name="city"
        label={t("register.fields.city")}
        options={PROVINCE_OPTIONS}
        placeholder={t("register.onboarding.business.city_placeholder")}
        searchPlaceholder={t("register.onboarding.business.city_search")}
        emptyText={t("register.onboarding.business.city_empty")}
      />
      <AppInput
        name="district"
        label={t("register.fields.district")}
        placeholder={t("register.onboarding.business.district_placeholder")}
      />
      <AppTextarea
        name="address"
        label={t("register.fields.address")}
        rows={2}
        className="sm:col-span-2"
      />
    </div>
  );
}

export function ServicesStep({
  services,
  onChange,
}: {
  services: StarterService[];
  onChange: (next: StarterService[]) => void;
}) {
  const { t } = useLocale();
  const update = (key: string, patch: Partial<StarterService>) =>
    onChange(services.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  return (
    <div>
      <ul className="divide-y rounded-2xl border">
        {services.map((service) => (
          <li
            key={service.key}
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 transition-colors",
              service.selected ? "bg-primary/5" : "",
            )}
          >
            <Checkbox
              id={`svc-${service.key}`}
              checked={service.selected}
              onCheckedChange={(checked) =>
                update(service.key, { selected: checked === true })
              }
            />
            <label
              htmlFor={`svc-${service.key}`}
              className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
            >
              {service.name}
            </label>
            <div className="relative w-28">
              <Input
                value={service.price}
                inputMode="decimal"
                disabled={!service.selected}
                onChange={(e) => update(service.key, { price: e.target.value })}
                className="h-8 pr-7 text-right tabular-nums"
                aria-label={`${service.name} · ${t("register.onboarding.services.price")}`}
              />
              <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                ₺
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs">
        {t("register.onboarding.services.hint")}
      </p>
    </div>
  );
}

const PASSWORD_RULES = [
  { key: "min", test: (v: string) => v.length >= 8 },
  { key: "upper", test: (v: string) => /[A-Z]/.test(v) },
  { key: "lower", test: (v: string) => /[a-z]/.test(v) },
  { key: "digit", test: (v: string) => /[0-9]/.test(v) },
] as const;

export function AccountStep() {
  const { t } = useLocale();
  const { control } = useFormContext<Values>();
  const password = useWatch({ control, name: "password" }) ?? "";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AppInput
        name="name"
        label={t("register.fields.name")}
        autoComplete="given-name"
        autoFocus
      />
      <AppInput
        name="surname"
        label={t("register.fields.surname")}
        autoComplete="family-name"
      />
      <AppInput
        name="email"
        type="email"
        label={t("register.fields.email")}
        autoComplete="email"
        className="sm:col-span-2"
      />
      <div className="sm:col-span-2">
        <AppPassword
          name="password"
          label={t("register.fields.password")}
          autoComplete="new-password"
        />
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {PASSWORD_RULES.map((rule) => {
            const ok = rule.test(password);
            return (
              <li
                key={rule.key}
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground",
                )}
              >
                <Check className={cn("size-3.5", !ok && "opacity-30")} />
                {t(`register.onboarding.password.${rule.key}`)}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
