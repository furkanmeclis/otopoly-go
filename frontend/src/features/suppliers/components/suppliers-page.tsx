"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
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
import { AppForm, AppInput, AppSwitch, AppTextarea } from "@/components/forms";
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
import { ResourceIOToolbar } from "@/features/io";
import {
  useSupplierMutations,
  useSuppliers,
  useSuppliersMeta,
} from "@/features/suppliers/hooks/use-suppliers";
import { useTenantSuppliersAccess } from "@/features/suppliers/hooks/use-tenant-suppliers-access";
import type { Supplier } from "@/features/suppliers/services/suppliers.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";

export function SuppliersPage({ slug }: { slug: string }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { canRead, canWrite } = useTenantSuppliersAccess(slug);
  const listState = useServerListState({
    initialSort: "name",
    initialPageSize: 20,
  });
  const listParams = useMemo(() => {
    const nameQ = columnTextValue(listState.columnFilters, "name");
    return {
      ...listState.params,
      q: listState.params.q?.trim() || nameQ,
      is_active: columnSelectValue(listState.columnFilters, "is_active"),
    };
  }, [listState.columnFilters, listState.params]);
  const listQuery = useSuppliers(listParams);
  const metaQuery = useSuppliersMeta();
  const [createOpen, setCreateOpen] = useState(false);

  const columns = useMemo<ColumnDef<Supplier>[]>(
    () => [
      createColumn<Supplier>({
        accessorKey: "name",
        labelKey: "suppliers.name",
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
      createColumn<Supplier>({
        accessorKey: "phone",
        labelKey: "suppliers.phone",
        cell: ({ row }) => row.original.phone || "—",
      }),
      createColumn<Supplier>({
        accessorKey: "tax_id",
        labelKey: "suppliers.tax_id",
        cell: ({ row }) => row.original.tax_id || "—",
      }),
      createColumn<Supplier>({
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
      createColumn<Supplier>({
        accessorKey: "created_at",
        labelKey: "suppliers.created_at",
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
        description={t("suppliers.forbidden")}
      />
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / (listParams.limit || 20)),
  );

  return (
    <EntityPage
      title={t("suppliers.title")}
      description={t("suppliers.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.tenant.home(slug) },
        { label: t("suppliers.title") },
      ]}
      actions={
        canWrite ? (
          <EntityCreateButton
            onClick={() => setCreateOpen(true)}
            label={t("suppliers.new")}
          />
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.tenant.suppliers.detail(slug, row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("suppliers.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("suppliers.empty_title")}
        emptyDescription={t("suppliers.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: `tenant-suppliers-${slug}`,
          columnFilters: true,
        }}
        toolbarExtra={
          <>
            <ResourceIOToolbar
              resource="tenant.suppliers"
              query={{
                q: listParams.q,
                is_active: listParams.is_active,
                sort: listParams.sort,
              }}
              capabilities={metaQuery.data?.capabilities}
              jobsHref={routes.tenant.exports.root(slug)}
              scope="tenant"
            />
            <EntityToolbar
              onRefresh={() => void listQuery.refetch()}
              refreshDisabled={listQuery.isFetching}
            />
          </>
        }
      />
      <SupplierDialog open={createOpen} onOpenChange={setCreateOpen} />
    </EntityPage>
  );
}

export function SupplierDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier | null;
}) {
  const { t } = useLocale();
  const { create, update } = useSupplierMutations();
  const isEdit = Boolean(supplier);
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        phone: z.string().optional(),
        email: z.string().optional(),
        tax_id: z.string().optional(),
        notes: z.string().optional(),
        is_active: z.boolean().default(true),
      }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("suppliers.dialog.edit_title")
              : t("suppliers.dialog.create_title")}
          </DialogTitle>
          <DialogDescription>
            {t("suppliers.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={
            open
              ? supplier
                ? `edit-${supplier.uuid}`
                : "create-open"
              : "closed"
          }
          schema={schema}
          defaultValues={{
            name: supplier?.name ?? "",
            phone: supplier?.phone ?? "",
            email: supplier?.email ?? "",
            tax_id: supplier?.tax_id ?? "",
            notes: supplier?.notes ?? "",
            is_active: supplier?.is_active ?? true,
          }}
          onSubmit={async (values) => {
            if (supplier) {
              await update.mutateAsync({ uuid: supplier.uuid, body: values });
            } else {
              await create.mutateAsync(values);
            }
            onOpenChange(false);
          }}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="name"
              label={t("suppliers.fields.name")}
              placeholder={t("suppliers.fields.name_placeholder")}
              required
            />
            <AppInput
              name="phone"
              label={t("suppliers.fields.phone")}
              placeholder={t("suppliers.fields.phone_placeholder")}
            />
            <AppInput name="email" label={t("suppliers.fields.email")} />
            <AppInput
              name="tax_id"
              label={t("suppliers.fields.tax_id")}
              placeholder={t("suppliers.fields.tax_id_placeholder")}
            />
            <AppTextarea name="notes" label={t("suppliers.fields.notes")} />
            <AppSwitch name="is_active" label={t("suppliers.fields.active")} />
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || update.isPending}
            >
              {create.isPending || update.isPending
                ? t("common.saving")
                : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
