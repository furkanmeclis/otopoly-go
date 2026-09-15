"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, Pencil, Wallet, XCircle } from "lucide-react";
import { useFormContext } from "react-hook-form";
import { z } from "zod";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntitySectionCard,
} from "@/components/entity";
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
import { routes } from "@/config/routes";
import { useFinanceAccounts } from "@/features/finance/hooks/use-finance-queries";
import { formatFinanceAmount } from "@/features/finance/lib/format";
import { JobContractsSection } from "@/features/contracts";
import { useJob, useJobsMutations } from "@/features/jobs/hooks/use-jobs";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import type {
  CloseJobInput,
  JobStatus,
} from "@/features/jobs/services/jobs.service";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

const CLOSE_METHODS = ["cash", "card", "cari"] as const;

function statusTone(status: JobStatus) {
  switch (status) {
    case "in_progress":
      return "warning" as const;
    case "done":
      return "default" as const;
    case "paid":
      return "success" as const;
    case "cancelled":
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

export function JobDetailPage({ slug, uuid }: { slug: string; uuid: string }) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite } = useTenantJobsAccess(slug);
  const jobQuery = useJob(uuid);
  const mutations = useJobsMutations();
  const job = jobQuery.data;

  const [notesOpen, setNotesOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const handleCancel = useCallback(async () => {
    const confirmed = await confirm({
      title: t("jobs.cancel.title"),
      description: t("jobs.cancel.description"),
      confirmLabel: t("jobs.cancel.confirm"),
      variant: "destructive",
    });
    if (!confirmed) return;
    await mutations.cancel.mutateAsync(uuid);
  }, [confirm, mutations.cancel, t, uuid]);

  const handleVoid = useCallback(async () => {
    const confirmed = await confirm({
      title: t("jobs.void.title"),
      description: t("jobs.void.description"),
      confirmLabel: t("jobs.void.confirm"),
      variant: "destructive",
    });
    if (!confirmed) return;
    await mutations.voidJob.mutateAsync(uuid);
  }, [confirm, mutations.voidJob, t, uuid]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("jobs.forbidden")}
      />
    );
  }

  const title = job?.plate ?? t("jobs.detail.title");
  const status = job?.status;

  return (
    <EntityPage
      title={title}
      description={t("jobs.detail.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("jobs.title"),
          href: routes.tenant.operations.root(slug),
        },
        { label: title },
      ]}
      actions={
        job && canWrite ? (
          <EntityActions>
            {status === "in_progress" || status === "done" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setNotesOpen(true)}
              >
                <Pencil className="size-4" />
                {t("jobs.actions.edit_notes")}
              </Button>
            ) : null}
            {status === "in_progress" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutations.done.isPending}
                onClick={() => void mutations.done.mutateAsync(uuid)}
              >
                <CheckCircle2 className="size-4" />
                {t("jobs.actions.done")}
              </Button>
            ) : null}
            {status === "in_progress" || status === "done" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCloseOpen(true)}
              >
                <Wallet className="size-4" />
                {t("jobs.actions.close")}
              </Button>
            ) : null}
            {status === "in_progress" || status === "done" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutations.cancel.isPending}
                onClick={() => void handleCancel()}
              >
                <XCircle className="size-4" />
                {t("jobs.actions.cancel")}
              </Button>
            ) : null}
            {status === "paid" ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={mutations.voidJob.isPending}
                onClick={() => void handleVoid()}
              >
                <Ban className="size-4" />
                {t("jobs.actions.void")}
              </Button>
            ) : null}
          </EntityActions>
        ) : null
      }
    >
      {jobQuery.isLoading ? <Loading label={t("common.loading")} /> : null}
      {jobQuery.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("jobs.detail.error")}
          onRetry={() => void jobQuery.refetch()}
        />
      ) : null}

      {job ? (
        <div className="space-y-6">
          <EntityHeader
            title={job.plate}
            subtitle={job.vehicle_label || undefined}
            badges={
              <StatusChip
                label={t(`jobs.status.${job.status}`)}
                tone={statusTone(job.status)}
              />
            }
          >
            <p className="text-lg font-semibold tabular-nums">
              {formatFinanceAmount(job.total_amount, job.currency, locale)}
            </p>
          </EntityHeader>

          <EntitySectionCard title={t("jobs.detail.info")}>
            <EntityDetail
              sections={[
                {
                  id: "info",
                  fields: [
                    {
                      key: "customer",
                      label: t("jobs.customer"),
                      value: (
                        <Link
                          href={routes.tenant.customers.detail(
                            slug,
                            job.customer_uuid,
                          )}
                          className="text-primary hover:underline"
                        >
                          {job.customer_name}
                        </Link>
                      ),
                    },
                    {
                      key: "phone",
                      label: t("jobs.customer_phone"),
                      value: job.customer_phone || "—",
                    },
                    {
                      key: "vehicle",
                      label: t("jobs.vehicle"),
                      value: `${job.plate}${job.vehicle_label ? ` · ${job.vehicle_label}` : ""}`,
                    },
                    {
                      key: "started",
                      label: t("jobs.started_at"),
                      value: datetime(
                        job.started_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                    {
                      key: "completed",
                      label: t("jobs.completed_at"),
                      value: job.completed_at
                        ? datetime(job.completed_at, "dd.MM.yyyy HH:mm", locale)
                        : "—",
                    },
                    {
                      key: "paid",
                      label: t("jobs.paid_at"),
                      value: job.paid_at
                        ? datetime(job.paid_at, "dd.MM.yyyy HH:mm", locale)
                        : "—",
                    },
                    {
                      key: "notes",
                      label: t("jobs.notes"),
                      value: job.notes || "—",
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          <EntitySectionCard
            title={t("jobs.detail.lines")}
            badge={job.lines?.length ?? 0}
          >
            {(job.lines?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("jobs.detail.lines_empty")}
              </p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {job.lines.map((line) => (
                  <li
                    key={line.uuid}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{line.name}</p>
                      <p className="text-muted-foreground tabular-nums">
                        {formatFinanceAmount(
                          line.unit_price,
                          line.currency,
                          locale,
                        )}{" "}
                        × {line.qty}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatFinanceAmount(
                        line.line_total,
                        line.currency,
                        locale,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </EntitySectionCard>

          <JobContractsSection slug={slug} jobUuid={job.uuid} />

          <EntitySectionCard
            title={t("jobs.detail.payments")}
            badge={job.payments?.length ?? 0}
          >
            {(job.payments?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("jobs.detail.payments_empty")}
              </p>
            ) : (
              <ul className="divide-border divide-y text-sm">
                {job.payments.map((payment) => (
                  <li
                    key={payment.uuid}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {t(`jobs.payment_method.${payment.method}`)}
                      </p>
                      <p className="text-muted-foreground">
                        {payment.finance_account_name ||
                          datetime(
                            payment.created_at,
                            "dd.MM.yyyy HH:mm",
                            locale,
                          )}
                      </p>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatFinanceAmount(
                        payment.amount,
                        payment.currency,
                        locale,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </EntitySectionCard>
        </div>
      ) : null}

      <NotesDialog
        open={notesOpen}
        onOpenChange={setNotesOpen}
        initialNotes={job?.notes ?? ""}
        pending={mutations.patch.isPending}
        onSubmit={async (notes) => {
          await mutations.patch.mutateAsync({ uuid, notes });
          setNotesOpen(false);
        }}
      />

      <CloseJobDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        pending={mutations.close.isPending}
        onSubmit={async (body) => {
          await mutations.close.mutateAsync({ uuid, body });
          setCloseOpen(false);
        }}
      />
    </EntityPage>
  );
}

function NotesDialog({
  open,
  onOpenChange,
  initialNotes,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNotes: string;
  pending?: boolean;
  onSubmit: (notes: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const schema = useMemo(
    () =>
      z.object({
        notes: z.string().optional(),
      }),
    [],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("jobs.actions.edit_notes")}</DialogTitle>
        </DialogHeader>
        <AppForm
          key={open ? `notes-${initialNotes}` : "notes-closed"}
          schema={schema}
          defaultValues={{ notes: initialNotes }}
          onSubmit={async (values) => {
            await onSubmit(values.notes?.trim() ?? "");
          }}
        >
          <FieldGroup className="gap-4">
            <AppTextarea name="notes" label={t("jobs.notes")} />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function CloseJobDialog({
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending?: boolean;
  onSubmit: (body: CloseJobInput) => Promise<void>;
}) {
  const { t } = useLocale();
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
