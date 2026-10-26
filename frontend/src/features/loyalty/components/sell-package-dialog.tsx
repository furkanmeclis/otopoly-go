"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import { AppForm, AppSelect, AppTextarea } from "@/components/forms";
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
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { CustomerField } from "@/features/loyalty/components/customer-field";
import {
  PaymentFields,
  needsAccount,
  useDefaultAccount,
} from "@/features/loyalty/components/payment-fields";
import {
  useLoyaltyMutations,
  useLoyaltyPackages,
} from "@/features/loyalty/hooks/use-loyalty";
import type { LoyaltyPackage } from "@/features/loyalty/services/loyalty.service";
import { useLocale } from "@/providers/locale-provider";

/** Sell a package definition to a customer (fixed when customerUuid is set). */
export function SellPackageDialog({
  open,
  onOpenChange,
  customerUuid,
  customerName,
  packageUuid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerUuid?: string;
  customerName?: string;
  packageUuid?: string;
}) {
  const { t } = useLocale();
  const { sellPackage } = useLoyaltyMutations();
  const packages = useLoyaltyPackages(
    { limit: 100, offset: 0, is_active: "true" },
    open,
  );
  const { defaultUuid } = useDefaultAccount();

  const schema = useMemo(
    () =>
      z
        .object({
          customer_uuid: z.string().min(1, t("form.required")),
          package_uuid: z.string().min(1, t("form.required")),
          method: z.enum(["cash", "card", "cari"]),
          finance_account_uuid: z.string().optional(),
          notes: z.string().optional(),
        })
        .superRefine((v, ctx) => {
          if (needsAccount(v.method, v.finance_account_uuid)) {
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("loyalty.sell.title")}</DialogTitle>
          <DialogDescription>
            {customerName
              ? t("loyalty.sell.description_for", { name: customerName })
              : t("loyalty.sell.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={
            open ? `sell-${defaultUuid}-${customerUuid ?? ""}` : "sell-closed"
          }
          schema={schema}
          defaultValues={{
            customer_uuid: customerUuid ?? "",
            package_uuid: packageUuid ?? "",
            method: "cash",
            finance_account_uuid: defaultUuid,
            notes: "",
          }}
          onSubmit={async (v) => {
            await sellPackage.mutateAsync({
              customer_uuid: v.customer_uuid,
              package_uuid: v.package_uuid,
              method: v.method,
              finance_account_uuid:
                v.method === "cari" ? null : v.finance_account_uuid || null,
              notes: v.notes?.trim() ?? "",
            });
            onOpenChange(false);
          }}
        >
          <FieldGroup className="gap-4">
            {customerUuid ? null : <CustomerField />}
            <AppSelect
              name="package_uuid"
              label={t("loyalty.fields.package")}
              placeholder={t("loyalty.fields.pick_package")}
              options={(packages.data?.items ?? []).map((p) => ({
                value: p.uuid,
                label: p.name,
              }))}
            />
            <PackageSummary packages={packages.data?.items ?? []} />
            <PaymentFields />
            <AppTextarea
              name="notes"
              label={t("loyalty.fields.notes")}
              rows={2}
            />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={sellPackage.isPending}>
              {sellPackage.isPending
                ? t("common.saving")
                : t("loyalty.sell.submit")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function PackageSummary({ packages }: { packages: LoyaltyPackage[] }) {
  const { t, locale } = useLocale();
  const form = useFormContext<{ package_uuid: string }>();
  const pkg = packages.find((p) => p.uuid === form.watch("package_uuid"));
  if (!pkg) return null;
  return (
    <div className="bg-muted/50 space-y-1 rounded-xl px-3 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{pkg.name}</span>
        <span className="text-lg font-semibold tabular-nums">
          {formatFinanceAmount(pkg.price, pkg.currency, locale)}
        </span>
      </div>
      <p className="text-muted-foreground">
        {pkg.items.map((i) => `${i.quantity}× ${i.service_name}`).join(", ")}
      </p>
      <p className="text-muted-foreground text-xs">
        {pkg.validity_days
          ? t("loyalty.packages.valid_days", { count: pkg.validity_days })
          : t("loyalty.packages.no_expiry")}
      </p>
    </div>
  );
}
