"use client";

import { useState } from "react";

import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useInvoiceProfile,
  useInvoiceProfileMutation,
} from "@/features/billing/hooks/use-billing";
import type { InvoiceProfile } from "@/features/billing/types";
import { isApiError } from "@/lib/api";
import { useLocale } from "@/providers/locale-provider";

export function InvoiceProfileCard({ canWrite }: { canWrite: boolean }) {
  const { t } = useLocale();
  const profile = useInvoiceProfile(true);
  return (
    <EntitySectionCard title={t("billing.profile.title")}>
      {profile.data ? (
        <ProfileForm initial={profile.data} canWrite={canWrite} />
      ) : (
        <Skeleton className="h-48 w-full" />
      )}
    </EntitySectionCard>
  );
}

function ProfileForm({
  initial,
  canWrite,
}: {
  initial: InvoiceProfile;
  canWrite: boolean;
}) {
  const { t } = useLocale();
  const save = useInvoiceProfileMutation();
  const [form, setForm] = useState<InvoiceProfile>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof InvoiceProfile, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const empty = !form.invoice_tax_id.trim();

  const submit = async () => {
    setError(null);
    const tax = form.invoice_tax_id.replace(/\D/g, "");
    if (tax && tax.length !== 10 && tax.length !== 11)
      return setError(t("billing.profile.tax_id_invalid"));
    try {
      setForm(await save.mutateAsync({ ...form, invoice_tax_id: tax }));
    } catch (err) {
      if (isApiError(err)) setError(err.message);
    }
  };

  const field = (
    k: keyof InvoiceProfile,
    label: string,
    extra?: { inputMode?: "numeric"; wide?: boolean },
  ) => (
    <div className={extra?.wide ? "sm:col-span-2" : undefined}>
      <Label className="mb-1 block">{label}</Label>
      <Input
        disabled={!canWrite}
        inputMode={extra?.inputMode}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {t("billing.profile.description")}
      </p>
      {empty ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {t("billing.profile.final_consumer")}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {field("invoice_name", t("billing.profile.name"), { wide: true })}
        {field("invoice_tax_id", t("billing.profile.tax_id"), {
          inputMode: "numeric",
        })}
        {field("invoice_tax_office", t("billing.profile.tax_office"))}
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.profile.address")}</Label>
          <Textarea
            rows={2}
            disabled={!canWrite}
            value={form.invoice_address}
            onChange={(e) => set("invoice_address", e.target.value)}
          />
        </div>
        {field("invoice_city", t("billing.profile.city"))}
        {field("invoice_email", t("billing.profile.email"))}
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button onClick={submit} disabled={save.isPending}>
            {t("billing.profile.save")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
