"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { EntitySectionCard } from "@/components/entity/entity-section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { SellerSettings } from "@/features/billing/types";
import {
  useSellerMutations,
  useSellerSettings,
} from "@/features/platform-billing/hooks/use-platform-billing";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

type SellerForm = Omit<SellerSettings, "xslt">;

export function SellerSettingsCards({ canEdit }: { canEdit: boolean }) {
  const seller = useSellerSettings(true);
  if (!seller.data) return <Skeleton className="h-64 w-full lg:col-span-2" />;
  return (
    <>
      <SellerCard initial={seller.data} canEdit={canEdit} />
      <XsltCard settings={seller.data} canEdit={canEdit} />
    </>
  );
}

function SellerCard({
  initial,
  canEdit,
}: {
  initial: SellerSettings;
  canEdit: boolean;
}) {
  const { t } = useLocale();
  const { save } = useSellerMutations();
  const { xslt: _x, ...rest } = initial;
  const [form, setForm] = useState<SellerForm>(rest);
  const set = (k: keyof SellerForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const input = (k: keyof SellerForm, label: string) => (
    <div>
      <Label className="mb-1 block">{label}</Label>
      <Input
        disabled={!canEdit}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );
  return (
    <EntitySectionCard title={t("billing.seller.title")}>
      <p className="text-muted-foreground mb-3 text-sm">
        {t("billing.seller.description")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {input("seller_name", t("billing.seller.name"))}
        </div>
        {input("seller_tax_id", t("billing.seller.tax_id"))}
        {input("seller_tax_office", t("billing.seller.tax_office"))}
        <div className="sm:col-span-2">
          <Label className="mb-1 block">{t("billing.seller.address")}</Label>
          <Textarea
            rows={2}
            disabled={!canEdit}
            value={form.seller_address}
            onChange={(e) => set("seller_address", e.target.value)}
          />
        </div>
        {input("seller_city", t("billing.seller.city"))}
        {input("seller_email", t("billing.seller.email"))}
        {input("seller_phone", t("billing.seller.phone"))}
        {input("seller_website", t("billing.seller.website"))}
        <div>
          <Label className="mb-1 block">{t("billing.seller.series")}</Label>
          <Input
            disabled={!canEdit}
            maxLength={3}
            className="font-mono uppercase"
            value={form.invoice_series}
            onChange={(e) =>
              set(
                "invoice_series",
                e.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
              )
            }
          />
        </div>
      </div>
      {canEdit ? (
        <div className="mt-3 flex justify-end">
          <Button disabled={save.isPending} onClick={() => save.mutate(form)}>
            {t("billing.seller.save")}
          </Button>
        </div>
      ) : null}
    </EntitySectionCard>
  );
}

function XsltCard({
  settings,
  canEdit,
}: {
  settings: SellerSettings;
  canEdit: boolean;
}) {
  const { t, locale } = useLocale();
  const { upload, reset } = useSellerMutations();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <EntitySectionCard title={t("billing.xslt.title")}>
      <p className="mb-2 text-sm">
        {settings.xslt.custom && settings.xslt.uploaded_at
          ? t("billing.xslt.custom", {
              date: datetime(
                settings.xslt.uploaded_at,
                "dd.MM.yyyy HH:mm",
                locale,
              ),
            })
          : t("billing.xslt.default")}
      </p>
      <p className="text-muted-foreground mb-3 text-xs">
        {t("billing.xslt.hint")}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xslt,.xsl,application/xml,text/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" />
            {t("billing.xslt.upload")}
          </Button>
          {settings.xslt.custom ? (
            <Button
              variant="ghost"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {t("billing.xslt.reset")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </EntitySectionCard>
  );
}
