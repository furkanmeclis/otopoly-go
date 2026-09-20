"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useWatch } from "react-hook-form";
import { z } from "zod";

import { ErrorState } from "@/components/common/error-state";
import { Loading } from "@/components/common/loading";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityDetail,
  EntityHeader,
  EntityPage,
  EntityRowActions,
  EntitySectionCard,
  EntityTable,
  type EntityRowAction,
} from "@/components/entity";
import {
  AppCombobox,
  AppForm,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea,
} from "@/components/forms";
import { createColumn } from "@/components/tables";
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
import { apiConfig } from "@/config/api";
import { routes } from "@/config/routes";
import { useCariEntries } from "@/features/cari/hooks/use-cari";
import { useTenantCariAccess } from "@/features/cari/hooks/use-tenant-cari-access";
import { useTenantCustomersAccess } from "@/features/customers/hooks/use-tenant-customers-access";
import {
  useCustomer,
  useCustomerMutations,
} from "@/features/customers/hooks/use-customers";
import {
  catalogPickerOptions,
  customersService,
  type Customer,
  type CustomerVehicle,
} from "@/features/customers/services/customers.service";
import {
  formatFinanceAmount,
  parseFinanceAmount,
} from "@/features/finance/lib/format";
import { useCustomerJobs } from "@/features/jobs/hooks/use-jobs";
import { useTenantJobsAccess } from "@/features/jobs/hooks/use-tenant-jobs-access";
import { datetime } from "@/lib/utils/format";
import { useDialogs } from "@/providers/dialog-provider";
import { useLocale } from "@/providers/locale-provider";

export function CustomerDetailPage({
  slug,
  uuid,
}: {
  slug: string;
  uuid: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { confirmDelete } = useDialogs();
  const { canRead, canWrite } = useTenantCustomersAccess(slug);
  const { canRead: canReadCari } = useTenantCariAccess(slug);
  const { canRead: canReadJobs } = useTenantJobsAccess(slug);
  const query = useCustomer(uuid);
  const mutations = useCustomerMutations();
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const customer = query.data;
  const vehicles = customer?.vehicles ?? [];
  const title = customer?.name ?? t("customers.title");
  const cariAccountUuid = customer?.cari_account_uuid ?? null;
  const recentEntriesQuery = useCariEntries(cariAccountUuid ?? "", {
    limit: 5,
    offset: 0,
  });
  const recentJobsQuery = useCustomerJobs(uuid, {
    limit: 5,
    offset: 0,
    sort: "-started_at",
  });

  const columns = useMemo<ColumnDef<CustomerVehicle>[]>(() => {
    const base: ColumnDef<CustomerVehicle>[] = [
      createColumn<CustomerVehicle>({
        accessorKey: "plate",
        labelKey: "customers.detail.plate",
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium tracking-wide">
            {row.original.plate}
          </span>
        ),
      }),
      createColumn<CustomerVehicle>({
        id: "vehicle",
        labelKey: "customers.detail.brand_model",
        accessorFn: (row) => `${row.brand_name} ${row.model_name}`,
        filterVariant: "text",
        cell: ({ row }) => {
          const logo = row.original.logo_url
            ? `${apiConfig.baseUrl.replace(/\/$/, "")}${row.original.logo_url}`
            : null;
          return (
            <div className="flex items-center gap-3">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="" className="h-6 w-12 object-contain" />
              ) : null}
              <span>
                {row.original.brand_name} {row.original.model_name}
              </span>
            </div>
          );
        },
      }),
      createColumn<CustomerVehicle>({
        accessorKey: "year",
        labelKey: "customers.detail.year",
        accessorFn: (row) => String(row.year),
        filterVariant: "text",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.year}</span>
        ),
      }),
    ];

    if (!canWrite) return base;

    base.push({
      id: "actions",
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const actions: EntityRowAction[] = [
          {
            id: "delete",
            label: t("common.delete"),
            icon: Trash2,
            variant: "destructive",
            onSelect: async () => {
              const confirmed = await confirmDelete({
                title: t("common.delete"),
                description: t("customers.detail.remove_vehicle_confirm"),
              });
              if (!confirmed) return;
              await mutations.removeVehicle.mutateAsync(row.original.uuid);
            },
          },
        ];
        return <EntityRowActions actions={actions} />;
      },
    });

    return base;
  }, [canWrite, confirmDelete, mutations.removeVehicle, t]);

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("customers.forbidden")}
      />
    );
  }

  return (
    <EntityPage
      title={title}
      description={t("customers.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        {
          label: t("customers.title"),
          href: routes.tenant.customers.root(slug),
        },
        { label: title },
      ]}
      actions={
        customer && canWrite ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" />
              {t("common.edit")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setVehicleOpen(true)}
            >
              {t("customers.detail.add_vehicle")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                const confirmed = await confirmDelete({
                  title: t("customers.detail.delete"),
                  description: t("customers.detail.delete_confirm"),
                });
                if (!confirmed) return;
                await mutations.remove.mutateAsync(uuid);
                router.push(routes.tenant.customers.root(slug));
              }}
            >
              {t("customers.detail.delete")}
            </Button>
          </EntityActions>
        ) : null
      }
    >
      {query.isLoading ? <Loading label={t("common.loading")} /> : null}
      {query.isError ? (
        <ErrorState
          title={t("common.error_generic")}
          description={t("customers.error_description")}
          onRetry={() => void query.refetch()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      {customer ? (
        <div className="space-y-6">
          <EntityHeader
            title={customer.name}
            subtitle={customer.phone || customer.email || undefined}
            badges={
              <>
                <StatusChip
                  label={
                    customer.is_active
                      ? t("common.active")
                      : t("common.passive")
                  }
                  tone={customer.is_active ? "success" : "default"}
                />
                <StatusChip
                  label={t(`customers.kind.${customer.kind}`)}
                  tone="default"
                />
                {cariAccountUuid && customer.cari_balance != null ? (
                  <Link
                    href={routes.tenant.cari.detail(slug, cariAccountUuid)}
                    className="inline-flex"
                  >
                    <StatusChip
                      label={t("customers.detail.cari_balance", {
                        amount: formatFinanceAmount(
                          customer.cari_balance,
                          "TRY",
                          locale,
                        ),
                      })}
                      tone={
                        parseFinanceAmount(customer.cari_balance) > 0
                          ? "warning"
                          : "default"
                      }
                    />
                  </Link>
                ) : null}
              </>
            }
          />

          <EntitySectionCard title={t("customers.detail.info")}>
            <EntityDetail
              sections={[
                {
                  id: "contact",
                  fields: [
                    {
                      key: "name",
                      label: t("customers.fields.name"),
                      value: customer.name,
                    },
                    {
                      key: "phone",
                      label: t("customers.fields.phone"),
                      value: customer.phone || "—",
                    },
                    {
                      key: "email",
                      label: t("customers.fields.email"),
                      value: customer.email || "—",
                    },
                    {
                      key: "kind",
                      label: t("customers.fields.kind"),
                      value: t(`customers.kind.${customer.kind}`),
                    },
                    ...(customer.kind === "company"
                      ? [
                          {
                            key: "tax_id",
                            label: t("customers.fields.tax_id"),
                            value: customer.tax_id || "—",
                          },
                          {
                            key: "tax_office",
                            label: t("customers.fields.tax_office"),
                            value: customer.tax_office || "—",
                          },
                        ]
                      : []),
                    {
                      key: "notes",
                      label: t("customers.fields.notes"),
                      value: customer.notes || "—",
                    },
                    {
                      key: "created",
                      label: t("customers.created_at"),
                      value: datetime(
                        customer.created_at,
                        "dd.MM.yyyy HH:mm",
                        locale,
                      ),
                    },
                  ],
                },
              ]}
            />
          </EntitySectionCard>

          {cariAccountUuid && canReadCari ? (
            <EntitySectionCard
              title={t("customers.detail.recent_cari_entries")}
              badge={recentEntriesQuery.data?.total}
            >
              <div className="mb-3 flex justify-end">
                <Link
                  href={routes.tenant.cari.detail(slug, cariAccountUuid)}
                  className="text-primary text-sm underline-offset-4 hover:underline"
                >
                  {t("customers.detail.view_cari")}
                </Link>
              </div>
              {recentEntriesQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">
                  {t("common.loading")}
                </p>
              ) : (
                <ul className="divide-border divide-y text-sm">
                  {(recentEntriesQuery.data?.items ?? []).map((entry) => (
                    <li
                      key={entry.uuid}
                      className="flex items-center justify-between gap-4 py-2"
                    >
                      <div className="min-w-0">
                        <p className="font-medium tabular-nums">
                          {entry.entry_date} ·{" "}
                          {t(`cari.entry_type.${entry.type}`)}
                        </p>
                        <p className="text-muted-foreground truncate">
                          {entry.description || "—"}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {formatFinanceAmount(entry.amount, "TRY", locale)}
                      </span>
                    </li>
                  ))}
                  {!recentEntriesQuery.data?.items?.length ? (
                    <li className="text-muted-foreground py-2">
                      {t("customers.detail.no_cari_entries")}
                    </li>
                  ) : null}
                </ul>
              )}
            </EntitySectionCard>
          ) : null}

          {canReadJobs ? (
            <EntitySectionCard
              title={t("customers.detail.recent_jobs")}
              badge={recentJobsQuery.data?.total}
            >
              <div className="mb-3 flex justify-end">
                <Link
                  href={routes.tenant.operations.root(slug)}
                  className="text-primary text-sm underline-offset-4 hover:underline"
                >
                  {t("customers.detail.view_jobs")}
                </Link>
              </div>
              {recentJobsQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">
                  {t("common.loading")}
                </p>
              ) : (
                <ul className="divide-border divide-y text-sm">
                  {(recentJobsQuery.data?.items ?? []).map((job) => (
                    <li key={job.uuid} className="py-2">
                      <Link
                        href={routes.tenant.operations.detail(slug, job.uuid)}
                        className="flex items-center justify-between gap-4 hover:underline"
                      >
                        <div className="min-w-0">
                          <p className="font-medium tracking-wide">
                            {job.plate} · {t(`jobs.status.${job.status}`)}
                          </p>
                          <p className="text-muted-foreground truncate">
                            {datetime(
                              job.started_at,
                              "dd.MM.yyyy HH:mm",
                              locale,
                            )}
                          </p>
                        </div>
                        <span className="shrink-0 tabular-nums">
                          {formatFinanceAmount(
                            job.total_amount,
                            job.currency,
                            locale,
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {!recentJobsQuery.data?.items?.length ? (
                    <li className="text-muted-foreground py-2">
                      {t("customers.detail.no_jobs")}
                    </li>
                  ) : null}
                </ul>
              )}
            </EntitySectionCard>
          ) : null}

          <EntitySectionCard
            title={t("customers.detail.vehicles")}
            badge={vehicles.length}
          >
            <EntityTable
              columns={columns}
              data={vehicles}
              getRowId={(row) => row.uuid}
              emptyTitle={t("customers.detail.no_vehicles")}
              emptyDescription={t(
                "customers.detail.vehicles_empty_description",
              )}
              features={{
                persistKey: `tenant-customer-vehicles-${uuid}`,
                columnFilters: true,
              }}
            />
          </EntitySectionCard>
        </div>
      ) : null}

      <CustomerEditDialog
        customer={editing ? customer : null}
        onOpenChange={(open) => {
          if (!open) setEditing(false);
        }}
      />
      <VehicleDialog
        open={vehicleOpen}
        pending={mutations.addVehicle.isPending}
        onOpenChange={setVehicleOpen}
        onSubmit={async (body) => {
          await mutations.addVehicle.mutateAsync({ customerUuid: uuid, body });
          setVehicleOpen(false);
        }}
      />
    </EntityPage>
  );
}

function CustomerEditDialog({
  customer,
  onOpenChange,
}: {
  customer: Customer | null | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { update } = useCustomerMutations();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        phone: z.string().optional(),
        email: z.string().optional(),
        kind: z.enum(["individual", "company"]),
        notes: z.string().optional(),
        tax_id: z.string().optional(),
        tax_office: z.string().optional(),
        is_active: z.boolean(),
      }),
    [t],
  );

  return (
    <Dialog open={Boolean(customer)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("customers.dialog.edit_title")}</DialogTitle>
          <DialogDescription>
            {t("customers.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        {customer ? (
          <AppForm
            key={customer.uuid}
            schema={schema}
            defaultValues={{
              name: customer.name,
              phone: customer.phone,
              email: customer.email,
              kind: customer.kind,
              notes: customer.notes,
              tax_id: customer.tax_id ?? "",
              tax_office: customer.tax_office ?? "",
              is_active: customer.is_active,
            }}
            onSubmit={async (values) => {
              await update.mutateAsync({
                uuid: customer.uuid,
                body: {
                  ...values,
                  tax_id: values.kind === "company" ? values.tax_id : "",
                  tax_office: values.kind === "company" ? values.tax_office : "",
                },
              });
              onOpenChange(false);
            }}
          >
            <CustomerFields />
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </AppForm>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomerFields() {
  const { t } = useLocale();
  const kind = useWatch({ name: "kind" }) as string | undefined;
  return (
    <FieldGroup className="gap-4">
      <AppInput
        name="name"
        label={t("customers.fields.name")}
        placeholder={t("customers.fields.name_placeholder")}
        required
      />
      <AppInput
        name="phone"
        label={t("customers.fields.phone")}
        placeholder={t("customers.fields.phone_placeholder")}
      />
      <AppInput name="email" label={t("customers.fields.email")} />
      <AppSelect
        name="kind"
        label={t("customers.fields.kind")}
        options={[
          { value: "individual", label: t("customers.kind.individual") },
          { value: "company", label: t("customers.kind.company") },
        ]}
      />
      {kind === "company" ? (
        <>
          <AppInput
            name="tax_id"
            label={t("customers.fields.tax_id")}
            placeholder={t("customers.fields.tax_id_placeholder")}
          />
          <AppInput
            name="tax_office"
            label={t("customers.fields.tax_office")}
            placeholder={t("customers.fields.tax_office_placeholder")}
          />
        </>
      ) : null}
      <AppTextarea name="notes" label={t("customers.fields.notes")} />
      <AppSwitch name="is_active" label={t("customers.fields.active")} />
    </FieldGroup>
  );
}

export function VehicleDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: {
    plate: string;
    model_uuid: string;
    year: number;
  }) => Promise<void>;
}) {
  const { t } = useLocale();
  const schema = useMemo(
    () =>
      z.object({
        plate: z.string().min(1, t("form.required")),
        catalog: z.string().min(1, t("form.required")),
      }),
    [t],
  );

  const loadOptions = useCallback(async (query: string) => {
    const result = await customersService.searchCatalog(query.trim());
    return catalogPickerOptions(result.items ?? []);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("customers.dialog.vehicle_title")}</DialogTitle>
          <DialogDescription>
            {t("customers.dialog.vehicle_description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "vehicle-open" : "vehicle-closed"}
          schema={schema}
          defaultValues={{ plate: "", catalog: "" }}
          onSubmit={async (values) => {
            const [modelUuid, yearText] = values.catalog.split(":");
            await onSubmit({
              plate: values.plate,
              model_uuid: modelUuid,
              year: Number(yearText),
            });
          }}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="plate"
              label={t("customers.detail.plate")}
              placeholder={t("customers.detail.plate_placeholder")}
              required
            />
            <AppCombobox
              name="catalog"
              label={t("customers.detail.catalog")}
              loadOptions={loadOptions}
              placeholder={t("customers.detail.search_placeholder")}
              searchPlaceholder={t("customers.detail.search_placeholder")}
              emptyText={t("customers.detail.search_empty")}
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
            <Button type="submit" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
