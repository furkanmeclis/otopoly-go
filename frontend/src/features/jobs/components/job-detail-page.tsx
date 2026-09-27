"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Ban,
  PackageCheck,
  Pencil,
  Truck,
  Wallet,
  XCircle,
} from "lucide-react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { routes } from "@/config/routes";
import {
  formatFinanceAmount,
  formatQuantity,
} from "@/features/finance/lib/format";
import { JobContractsSection } from "@/features/contracts";
import { CloseJobDialog } from "@/features/jobs/components/close-job-dialog";
import { JobConsumptionsCard } from "@/features/jobs/components/job-consumptions-card";
import { useJob, useJobsMutations } from "@/features/jobs/hooks/use-jobs";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import type {
  JobStatus,
  PaymentStatus,
} from "@/features/jobs/services/jobs.service";
import { useStaffOptions } from "@/features/staff/hooks/use-staff";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

function statusTone(status: JobStatus) {
  switch (status) {
    case "in_progress":
      return "warning" as const;
    case "ready":
      return "default" as const;
    case "delivered":
      return "success" as const;
    case "cancelled":
    case "voided":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

function paymentTone(status: PaymentStatus) {
  return status === "paid" ? ("success" as const) : ("warning" as const);
}

export function JobDetailPage({ slug, uuid }: { slug: string; uuid: string }) {
  const { t, locale } = useLocale();
  const { confirm } = useDialogs();
  const { canRead, canWrite, canVoid } = useTenantJobsAccess(slug);
  const jobQuery = useJob(uuid);
  const mutations = useJobsMutations();
  const job = jobQuery.data;
  const staffOptionsQuery = useStaffOptions(canWrite);

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
  const paymentStatus = job?.payment_status;
  const canEdit = canWrite && (status === "in_progress" || status === "ready");
  const canPay =
    canWrite &&
    paymentStatus === "unpaid" &&
    status !== "cancelled" &&
    status !== "voided";
  const canCancel =
    canWrite && (status === "in_progress" || status === "ready");

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
            {canEdit ? (
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
                <PackageCheck className="size-4" />
                {t("jobs.actions.ready")}
              </Button>
            ) : null}
            {status === "ready" || status === "in_progress" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={mutations.deliver.isPending}
                onClick={() => void mutations.deliver.mutateAsync(uuid)}
              >
                <Truck className="size-4" />
                {t("jobs.actions.deliver")}
              </Button>
            ) : null}
            {canPay ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCloseOpen(true)}
              >
                <Wallet className="size-4" />
                {t("jobs.actions.close")}
              </Button>
            ) : null}
            {canCancel ? (
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
            {canVoid && paymentStatus === "paid" ? (
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
              <div className="flex flex-wrap gap-2">
                <StatusChip
                  label={t(`jobs.status.${job.status}`)}
                  tone={statusTone(job.status)}
                />
                <StatusChip
                  label={t(`jobs.payment.${job.payment_status}`)}
                  tone={paymentTone(job.payment_status)}
                />
              </div>
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
                      key: "assignee",
                      label: t("jobs.assignee"),
                      value: job.assignee_name || "—",
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
                        × {formatQuantity(line.qty, locale)}
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

          <JobConsumptionsCard job={job} canWrite={canWrite} />

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
        initialAssigneeUuid={job?.assignee_uuid ?? ""}
        assigneeOptions={(staffOptionsQuery.data?.items ?? []).map((m) => ({
          value: m.uuid,
          label: m.label,
        }))}
        pending={mutations.patch.isPending}
        onSubmit={async ({ notes, assignee_uuid }) => {
          await mutations.patch.mutateAsync({
            uuid,
            notes,
            assignee_uuid: assignee_uuid || null,
          });
          setNotesOpen(false);
        }}
      />

      <CloseJobDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        job={job}
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
  initialAssigneeUuid,
  assigneeOptions,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialNotes: string;
  initialAssigneeUuid: string;
  assigneeOptions: { value: string; label: string }[];
  pending?: boolean;
  onSubmit: (values: { notes: string; assignee_uuid: string }) => Promise<void>;
}) {
  const { t } = useLocale();
  const schema = useMemo(
    () =>
      z.object({
        notes: z.string().optional(),
        assignee_uuid: z.string().optional(),
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
          key={
            open
              ? `notes-${initialNotes}-${initialAssigneeUuid}`
              : "notes-closed"
          }
          schema={schema}
          defaultValues={{
            notes: initialNotes,
            assignee_uuid: initialAssigneeUuid,
          }}
          onSubmit={async (values) => {
            await onSubmit({
              notes: values.notes?.trim() ?? "",
              assignee_uuid: values.assignee_uuid?.trim() ?? "",
            });
          }}
        >
          <FieldGroup className="gap-4">
            <AppSelect
              name="assignee_uuid"
              label={t("jobs.assignee")}
              options={[
                { value: "", label: t("jobs.assignee_none") },
                ...assigneeOptions,
              ]}
              placeholder={t("jobs.pick_assignee")}
            />
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
