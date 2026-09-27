"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import { AppForm, AppSelect } from "@/components/forms";
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
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { PlateBadge } from "@/features/jobs/components/plate-badge";
import type { CloseJobInput } from "@/features/jobs/services/jobs.service";
import { useLocale } from "@/providers/locale-provider";

const CLOSE_METHODS = ["cash", "card", "cari"] as const;

type CloseJobSummary = {
  plate: string;
  customer_name: string;
  total_amount: string;
  currency: string;
};

/**
 * Payment / close dialog. Used from the job detail page and straight from
 * the operations board and list so staff never have to open the job.
 */
export function CloseJobDialog({
  open,
  onOpenChange,
  job,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job?: CloseJobSummary | null;
  pending?: boolean;
  onSubmit: (body: CloseJobInput) => Promise<void>;
}) {
  const { t, locale } = useLocale();
  const accountsQuery = useFinanceAccounts({
    limit: 100,
    offset: 0,
    is_active: "true",
  });
  const accounts = accountsQuery.data?.items ?? [];
  const defaultAccountUuid =
    accounts.find((account) => account.is_default)?.uuid ??
    accounts[0]?.uuid ??
    "";

  const schema = useMemo(
    () =>
      z
        .object({
          method: z.enum(CLOSE_METHODS),
          finance_account_uuid: z.string().optional(),
        })
        .superRefine((values, ctx) => {
          if (
            (values.method === "cash" || values.method === "card") &&
            !values.finance_account_uuid
          ) {
            ctx.addIssue({
              code: "custom",
              path: ["finance_account_uuid"],
              message: t("jobs.validation.finance_account"),
            });
          }
        }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("jobs.actions.close")}</DialogTitle>
          <DialogDescription>{t("jobs.close.description")}</DialogDescription>
        </DialogHeader>
        {job ? (
          <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <PlateBadge plate={job.plate} size="sm" />
              <span className="truncate text-sm font-medium">
                {job.customer_name}
              </span>
            </div>
            <span className="text-lg font-semibold tabular-nums">
              {formatFinanceAmount(job.total_amount, job.currency, locale)}
            </span>
          </div>
        ) : null}
        <AppForm
          key={open ? `close-${defaultAccountUuid}` : "close-closed"}
          schema={schema}
          defaultValues={{
            method: "cash",
            finance_account_uuid: defaultAccountUuid,
          }}
          onSubmit={async (values) => {
            await onSubmit({
              method: values.method,
              finance_account_uuid:
                values.method === "cari"
                  ? undefined
                  : values.finance_account_uuid || undefined,
            });
          }}
        >
          <CloseJobFields
            accounts={accounts}
            pending={pending}
            onCancel={() => onOpenChange(false)}
          />
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function CloseJobFields({
  accounts,
  pending,
  onCancel,
}: {
  accounts: { uuid: string; name: string; currency: string }[];
  pending?: boolean;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const form = useFormContext<{
    method: "cash" | "card" | "cari";
    finance_account_uuid?: string;
  }>();
  const method = form.watch("method");

  return (
    <>
      <FieldGroup className="gap-4">
        <AppSelect
          name="method"
          label={t("jobs.close.method")}
          options={CLOSE_METHODS.map((value) => ({
            value,
            label: t(`jobs.payment_method.${value}`),
          }))}
        />
        {method !== "cari" ? (
          <AppSelect
            name="finance_account_uuid"
            label={t("jobs.finance_account")}
            placeholder={t("jobs.pick_finance_account")}
            options={accounts.map((account) => ({
              value: account.uuid,
              label: `${account.name} (${account.currency})`,
            }))}
          />
        ) : null}
      </FieldGroup>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("jobs.actions.close")}
        </Button>
      </DialogFooter>
    </>
  );
}
