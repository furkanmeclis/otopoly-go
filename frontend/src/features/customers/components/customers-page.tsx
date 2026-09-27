"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { useWatch } from "react-hook-form";
import { z } from "zod";

import {
  EntityCreateButton,
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  AppCombobox,
  AppForm,
  AppInput,
  AppSelect,
  AppSwitch,
  AppTextarea,
} from "@/components/forms";
import { createColumn } from "@/components/tables";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
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
import { useTenantCustomersAccess } from "@/features/customers/hooks/use-tenant-customers-access";
import {
  useCustomerMutations,
  useCustomers,
} from "@/features/customers/hooks/use-customers";
import {
  catalogPickerOptions,
  customersService,
  type Customer,
} from "@/features/customers/services/customers.service";
import { datetime } from "@/lib/utils/format";
import { MeterFor } from "@/features/billing";
import { useLocale } from "@/providers/locale-provider";

export function CustomersPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantCustomersAccess(slug);
  const listState = useServerListState({
    initialSort: "name",
    initialPageSize: 20,
  });
  const listParams = useMemo(() => {
    const nameQ = columnTextValue(listState.columnFilters, "name");
    return {
      ...listState.params,
      q: listState.params.q?.trim() || nameQ,
      kind: columnSelectValue(listState.columnFilters, "kind"),
      is_active: columnSelectValue(listState.columnFilters, "is_active"),
    };
  }, [listState.columnFilters, listState.params]);
  const listQuery = useCustomers(listParams);
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useMemo<ColumnDef<Customer>[]>(
    () => [
      createColumn<Customer>({
        accessorKey: "name",
        labelKey: "customers.name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{row.original.name}</span>
            {row.original.email ? (
              <span className="text-muted-foreground text-xs">
                {row.original.email}
              </span>
            ) : null}
          </div>
        ),
      }),
      createColumn<Customer>({
        accessorKey: "phone",
        labelKey: "customers.phone",
        cell: ({ row }) => row.original.phone || "—",
      }),
      createColumn<Customer>({
        id: "kind",
        labelKey: "customers.kind",
        accessorFn: (row) => row.kind,
        filterVariant: "select",
        filterOptions: [
          {
            value: "individual",
            labelKey: "customers.kind.individual",
            label: "individual",
          },
          {
            value: "company",
            labelKey: "customers.kind.company",
            label: "company",
          },
        ],
        cell: ({ row }) => t(`customers.kind.${row.original.kind}`),
      }),
      createColumn<Customer>({
        accessorKey: "vehicle_count",
        labelKey: "customers.vehicle_count",
      }),
      createColumn<Customer>({
        id: "is_active",
        labelKey: "common.status",
        accessorFn: (row) => (row.is_active ? "true" : "false"),
        filterVariant: "select",
        filterOptions: [
          { value: "true", labelKey: "common.active", label: "true" },
          { value: "false", labelKey: "common.passive", label: "false" },
        ],
        cell: ({ row }) => (
          <StatusChip
            label={
              row.original.is_active ? t("common.active") : t("common.passive")
            }
            tone={row.original.is_active ? "success" : "default"}
          />
        ),
      }),
      createColumn<Customer>({
        accessorKey: "created_at",
        labelKey: "customers.created_at",
        cell: ({ row }) =>
          datetime(row.original.created_at, "dd.MM.yyyy", locale),
      }),
    ],
    [locale, t],
  );

  if (!canRead) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("customers.forbidden")}
      />
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / (listParams.limit || 20)),
  );

  return (
    <EntityPage
      title={t("customers.title")}
      description={t("customers.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("customers.title") },
      ]}
      actions={
        <div className="flex flex-wrap items-center gap-4">
          <MeterFor keyName="customers.count" />
          {canWrite ? (
            <EntityCreateButton
              onClick={() => setCreateOpen(true)}
              label={t("customers.new")}
            />
          ) : null}
        </div>
      }
    >
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.tenant.customers.detail(slug, row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("customers.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("customers.empty_title")}
        emptyDescription={t("customers.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: `tenant-customers-${slug}`,
          columnFilters: true,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />
      <CustomerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </EntityPage>
  );
}

function CustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { create } = useCustomerMutations();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        phone: z.string().optional(),
        email: z.string().optional(),
        kind: z.enum(["individual", "company"]).default("individual"),
        notes: z.string().optional(),
        tax_id: z.string().optional(),
        tax_office: z.string().optional(),
        is_active: z.boolean().default(true),
        plate: z.string().optional(),
        catalog: z.string().optional(),
      }),
    [t],
  );
  const loadOptions = useCallback(async (query: string) => {
    const result = await customersService.searchCatalog(query.trim());
    return catalogPickerOptions(result.items ?? []);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("customers.dialog.create_title")}</DialogTitle>
          <DialogDescription>
            {t("customers.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "customer-open" : "customer-closed"}
          schema={schema}
          defaultValues={{
            name: "",
            phone: "",
            email: "",
            kind: "individual",
            notes: "",
            tax_id: "",
            tax_office: "",
            is_active: true,
            plate: "",
            catalog: "",
          }}
          onSubmit={async (values) => {
            const plate = values.plate?.trim();
            const catalog = values.catalog?.trim();
            let vehicle:
              { plate: string; model_uuid: string; year: number } | undefined;
            if (plate && catalog) {
              const [modelUuid, yearText] = catalog.split(":");
              vehicle = {
                plate,
                model_uuid: modelUuid,
                year: Number(yearText),
              };
            }
            await create.mutateAsync({
              name: values.name,
              phone: values.phone,
              email: values.email,
              kind: values.kind,
              notes: values.notes,
              tax_id: values.kind === "company" ? values.tax_id : "",
              tax_office: values.kind === "company" ? values.tax_office : "",
              is_active: values.is_active,
              vehicle,
            });
            onOpenChange(false);
          }}
        >
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
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
            <CompanyTaxFields />
            <AppTextarea
              name="notes"
              label={t("customers.fields.notes")}
              className="sm:col-span-2"
            />
            <AppSwitch
              name="is_active"
              label={t("customers.fields.active")}
              className="sm:col-span-2"
            />
          </FieldGroup>
          <div className="border-border mt-6 space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("customers.dialog.vehicle_section")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("customers.dialog.vehicle_section_hint")}
              </p>
            </div>
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <AppInput
                name="plate"
                label={t("customers.detail.plate")}
                placeholder={t("customers.detail.plate_placeholder")}
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
          </div>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function CompanyTaxFields() {
  const { t } = useLocale();
  const kind = useWatch({ name: "kind" }) as string | undefined;
  if (kind !== "company") return null;
  return (
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
  );
}
