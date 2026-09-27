"use client";

import { useState } from "react";

import { EntityPage } from "@/components/entity/entity-page";
import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { permissions } from "@/config/permissions";
import type { PaymentSettings } from "@/features/billing/types";
import { SellerSettingsCards } from "@/features/platform-billing/components/seller-settings-cards";
import {
  usePaymentSettings,
  usePaymentSettingsMutation,
  usePlatformBillingAccess,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { useLocale } from "@/providers/locale-provider";

const IBAN_RE = /^TR\d{24}$/;
const normalizeIban = (v: string) => v.replace(/\s+/g, "").toUpperCase();
const groupIban = (v: string) =>
  normalizeIban(v)
    .replace(/(.{4})/g, "$1 ")
    .trim();
const clampInt = (v: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(Number(v)) || min));

export function PaymentSettingsPage() {
  const { t } = useLocale();
  const access = usePlatformBillingAccess();
  const settings = usePaymentSettings(access.canRead);
  return (
    <EntityPage
      title={t("billing.settings.title")}
      description={t("billing.settings.description")}
      permission={permissions.platformBilling.read}
    >
      {settings.data ? (
        <div className="space-y-6">
          <SettingsForm initial={settings.data} canEdit={access.canSettings} />
          <div className="grid gap-6 lg:grid-cols-2">
            <SellerSettingsCards canEdit={access.canSettings} />
          </div>
        </div>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </EntityPage>
  );
}

function SettingsForm({
  initial,
  canEdit,
}: {
  initial: PaymentSettings;
  canEdit: boolean;
}) {
  const { t } = useLocale();
  const save = usePaymentSettingsMutation();
  const [form, setForm] = useState<PaymentSettings>(initial);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof PaymentSettings>(k: K, v: PaymentSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    const iban = normalizeIban(form.iban);
    if (iban && !IBAN_RE.test(iban))
      return setError(t("billing.settings.iban_invalid"));
    try {
      setForm(await save.mutateAsync({ ...form, iban }));
    } catch {
      /* toast via global handler */
    }
  };

  const disabled = !canEdit || save.isPending;

  return (
    <div className="space-y-4">
      <div className="grid gap-6 lg:grid-cols-2">
        <EntitySectionCard title={t("billing.settings.bank")}>
          <div className="space-y-3">
            <Field label={t("billing.settings.bank_name")}>
              <Input
                disabled={disabled}
                value={form.bank_name}
                onChange={(e) => set("bank_name", e.target.value)}
              />
            </Field>
            <Field label={t("billing.settings.account_holder")}>
              <Input
                disabled={disabled}
                value={form.account_holder}
                onChange={(e) => set("account_holder", e.target.value)}
              />
            </Field>
            <Field label={t("billing.settings.iban")}>
              <Input
                disabled={disabled}
                className="font-mono"
                value={groupIban(form.iban)}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                onChange={(e) =>
                  set("iban", normalizeIban(e.target.value).slice(0, 26))
                }
              />
            </Field>
            <Field
              label={t("billing.settings.payment_instructions")}
              hint={t("billing.settings.payment_instructions_hint")}
            >
              <Textarea
                disabled={disabled}
                rows={3}
                value={form.payment_instructions}
                onChange={(e) => set("payment_instructions", e.target.value)}
              />
            </Field>
          </div>
        </EntitySectionCard>
        <EntitySectionCard title={t("billing.settings.rules")}>
          <div className="space-y-3">
            <Field label={t("billing.settings.order_ttl_days")}>
              <Input
                type="number"
                min={1}
                max={30}
                disabled={disabled}
                value={form.order_ttl_days}
                onChange={(e) =>
                  set("order_ttl_days", clampInt(e.target.value, 1, 30))
                }
              />
            </Field>
            <Field label={t("billing.settings.grace_days")}>
              <Input
                type="number"
                min={0}
                max={30}
                disabled={disabled}
                value={form.grace_days}
                onChange={(e) =>
                  set("grace_days", clampInt(e.target.value, 0, 30))
                }
              />
            </Field>
            <Field label={t("billing.settings.vat_rate")}>
              <Input
                type="number"
                min={0}
                max={100}
                disabled={disabled}
                value={form.vat_rate}
                onChange={(e) =>
                  set("vat_rate", clampInt(e.target.value, 0, 100))
                }
              />
            </Field>
          </div>
        </EntitySectionCard>
        {error ? (
          <p className="text-destructive text-sm lg:col-span-2">{error}</p>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button onClick={submit} disabled={disabled}>
            {t("billing.settings.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      {children}
      {hint ? (
        <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
