"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

import { ErrorState } from "@/components/common/error-state";
import { StatusChip } from "@/components/common/status-chip";
import {
  EntityActions,
  EntityCreateButton,
  EntityPage,
  EntityTable,
  EntityToolbar,
  useServerListState,
} from "@/components/entity";
import { AppForm, AppInput, AppSwitch } from "@/components/forms";
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
import { permissions } from "@/config/permissions";
import {
  useVehicleBrandMutations,
  useVehicleBrands,
} from "@/features/vehicle-brands/hooks/use-vehicle-brands";
import type { VehicleBrand } from "@/features/vehicle-brands/services/vehicle-brands.service";
import { datetime } from "@/lib/utils/format";
import { useLocale } from "@/providers/locale-provider";
import { usePermission } from "@/providers/permission-provider";
import { createColumn } from "@/components/tables";
import {
  columnSelectValue,
  columnTextValue,
} from "@/features/catalog/lib/column-filters";
import type { ColumnDef } from "@tanstack/react-table";

export function VehicleBrandsPage() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { hasPermission } = usePermission();
  const canWrite = hasPermission(permissions.vehicleBrands.write);
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
  const listQuery = useVehicleBrands(listParams);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const columns = useMemo<ColumnDef<VehicleBrand>[]>(
    () => [
      createColumn<VehicleBrand>({
        id: "logo",
        labelKey: "vehicle_brands.detail.logo",
        enableSorting: false,
        cell: ({ row }) => {
          const src = row.original.logo_url
            ? `${apiConfig.baseUrl.replace(/\/$/, "")}${row.original.logo_url}`
            : null;
          if (!src) {
            return <span className="text-muted-foreground text-xs">—</span>;
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="h-8 w-16 object-contain" />
          );
        },
      }),
      createColumn<VehicleBrand>({
        accessorKey: "name",
        labelKey: "vehicle_brands.name",
        enableSorting: true,
        filterVariant: "text",
        gridPrimary: true,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      }),
      createColumn<VehicleBrand>({
        accessorKey: "model_count",
        labelKey: "vehicle_brands.model_count",
      }),
      createColumn<VehicleBrand>({
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
      createColumn<VehicleBrand>({
        accessorKey: "created_at",
        labelKey: "vehicle_brands.created_at",
        cell: ({ row }) =>
          datetime(row.original.created_at, "dd.MM.yyyy", locale),
      }),
    ],
    [locale, t],
  );

  if (!hasPermission(permissions.vehicleBrands.read)) {
    return (
      <ErrorState
        title={t("common.error_forbidden")}
        description={t("vehicle_brands.forbidden")}
      />
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil((listQuery.data?.total ?? 0) / (listParams.limit || 20)),
  );

  return (
    <EntityPage
      title={t("vehicle_brands.title")}
      description={t("vehicle_brands.description")}
      breadcrumbs={[
        { label: t("layout.breadcrumb_home"), href: routes.platform.home },
        { label: t("vehicle_brands.title") },
      ]}
      actions={
        canWrite ? (
          <EntityActions>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setImportOpen(true)}
            >
              {t("vehicle_brands.import")}
            </Button>
            <EntityCreateButton
              onClick={() => setCreateOpen(true)}
              label={t("vehicle_brands.new")}
            />
          </EntityActions>
        ) : null
      }
    >
      <EntityTable
        columns={columns}
        data={listQuery.data?.items ?? []}
        getRowId={(row) => row.uuid}
        onRowClick={(row) =>
          router.push(routes.platform.vehicleBrands.detail(row.uuid))
        }
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        errorDescription={t("vehicle_brands.error_description")}
        onRetry={() => void listQuery.refetch()}
        emptyTitle={t("vehicle_brands.empty_title")}
        emptyDescription={t("vehicle_brands.empty_description")}
        pageCount={pageCount}
        state={listState.tableState}
        manual={{ filtering: true, sorting: true, pagination: true }}
        features={{
          persistKey: "platform-vehicle-brands",
          columnFilters: true,
        }}
        toolbarExtra={
          <EntityToolbar
            onRefresh={() => void listQuery.refetch()}
            refreshDisabled={listQuery.isFetching}
          />
        }
      />
      <BrandDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </EntityPage>
  );
}

function BrandDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { create } = useVehicleBrandMutations();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("form.required")),
        is_active: z.boolean().default(true),
      }),
    [t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("vehicle_brands.dialog.create_title")}</DialogTitle>
          <DialogDescription>
            {t("vehicle_brands.dialog.description")}
          </DialogDescription>
        </DialogHeader>
        <AppForm
          key={open ? "brand-open" : "brand-closed"}
          schema={schema}
          defaultValues={{ name: "", is_active: true }}
          onSubmit={async (values) => {
            await create.mutateAsync(values);
            onOpenChange(false);
          }}
        >
          <FieldGroup className="gap-4">
            <AppInput
              name="name"
              label={t("vehicle_brands.fields.name")}
              placeholder={t("vehicle_brands.dialog.name_placeholder")}
              required
            />
            <AppSwitch
              name="is_active"
              label={t("vehicle_brands.fields.active")}
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
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { importJson } = useVehicleBrandMutations();
  const [file, setFile] = useState<File | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFile(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("vehicle_brands.import.title")}</DialogTitle>
          <DialogDescription>
            {t("vehicle_brands.import.description")}
          </DialogDescription>
        </DialogHeader>
        <label className="border-border hover:bg-muted/40 flex cursor-pointer flex-col gap-1 rounded-lg border border-dashed px-4 py-6 text-sm">
          <span className="font-medium">
            {t("vehicle_brands.import.choose")}
          </span>
          <span className="text-muted-foreground text-xs">
            {file
              ? `${t("vehicle_brands.import.selected")}: ${file.name}`
              : "JSON"}
          </span>
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <DialogFooter className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!file || importJson.isPending}
            onClick={async () => {
              if (!file) return;
              const text = await file.text();
              const payload = JSON.parse(text) as Record<
                string,
                Record<string, string[]>
              >;
              await importJson.mutateAsync(payload);
              setFile(null);
              onOpenChange(false);
            }}
          >
            {importJson.isPending
              ? t("common.saving")
              : t("vehicle_brands.import.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
